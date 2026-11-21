const AppError = require('../../utils/AppError');
const { slugify } = require('../../utils/slug');
const pagination = require('../../utils/pagination');
const vendorRepository = require('./vendor.repository');
const userRepository = require('../users/user.repository');

// Turns a Mongo duplicate-key error (code 11000) into a friendly 409.
function duplicateError(err) {
  const field = Object.keys(err.keyPattern || {})[0];
  if (field === 'userId') {
    return new AppError('APPLICATION_EXISTS', 'You already have a vendor application', 409);
  }
  return new AppError('STORE_NAME_TAKEN', 'This store name is already taken', 409);
}

async function apply(userId, { storeName, description, bankDetails }) {
  const data = { storeName, storeSlug: slugify(storeName), description, bankDetails };
  const existing = await vendorRepository.findByUserId(userId);

  if (existing && existing.status !== 'REJECTED') {
    throw new AppError('APPLICATION_EXISTS', `You already have a ${existing.status} vendor application`, 409);
  }

  try {
    if (!existing) return await vendorRepository.create({ userId, ...data });
    // Previously REJECTED: reuse the same document (userId is unique).
    const updated = await vendorRepository.reapply(userId, data);
    // null = it stopped being REJECTED in the meantime (e.g. a parallel request).
    if (!updated) throw new AppError('APPLICATION_EXISTS', 'You already have a vendor application', 409);
    return updated;
  } catch (err) {
    if (err.code === 11000) throw duplicateError(err);
    throw err;
  }
}

// Public store page. Looked up by the vendor's USER id, which is the same id
// products carry as vendorId. Only approved stores are visible.
async function getPublicProfile(vendorUserId) {
  const profile = await vendorRepository.findByUserId(vendorUserId);
  if (!profile || profile.status !== 'APPROVED') {
    throw new AppError('NOT_FOUND', 'Vendor not found', 404);
  }
  // Pick fields explicitly: bank details are never part of this response.
  return {
    vendorId: String(profile.userId),
    storeName: profile.storeName,
    storeSlug: profile.storeSlug,
    description: profile.description,
    createdAt: profile.createdAt,
  };
}

async function decide(applicationId, { decision, reason }, adminId) {
  const profile = await vendorRepository.decide(applicationId, {
    status: decision,
    rejectionReason: decision === 'REJECTED' ? reason : null,
    reviewedBy: adminId,
  });

  if (!profile) {
    const exists = await vendorRepository.findById(applicationId);
    if (!exists) throw new AppError('NOT_FOUND', 'Vendor application not found', 404);
    throw new AppError('APPLICATION_ALREADY_DECIDED', `Application is already ${exists.status}`, 409);
  }

  if (decision === 'APPROVED') {
    // $addToSet: adds VENDOR only if it isn't there yet (safe to repeat).
    // Two separate documents, so this is not atomic with the status change.
    // If it fails, the error is returned to the admin; the profile is APPROVED
    // but the user lacks the role until it is added (e.g. by support).
    await userRepository.addRole(profile.userId, 'VENDOR');
  }
  return profile;
}

// Admin list: newest first, optional status filter, cursor pagination.
async function listApplications({ status, limit, cursor }) {
  const filter = status ? { status } : {};
  if (cursor) {
    Object.assign(
      filter,
      pagination.afterCursorFilter('createdAt', -1, pagination.decodeCursor(cursor, pagination.parseDate))
    );
  }
  const docs = await vendorRepository.list(filter, pagination.sortSpec('createdAt', -1), limit + 1);
  return pagination.buildPage(docs, limit, 'createdAt');
}

module.exports = { apply, getPublicProfile, decide, listApplications };
