const { VendorProfile } = require('./vendorProfile.model');

function create(data) {
  return VendorProfile.create(data);
}

function findById(id) {
  return VendorProfile.findById(id);
}

function findByUserId(userId) {
  return VendorProfile.findOne({ userId });
}

// Re-application: only succeeds if the current application is REJECTED
// (checked in the same atomic step as the update). Returns null otherwise.
function reapply(userId, data) {
  return VendorProfile.findOneAndUpdate(
    { userId, status: 'REJECTED' },
    {
      $set: { ...data, status: 'PENDING', rejectionReason: null, reviewedBy: null, reviewedAt: null },
    },
    { returnDocument: 'after', runValidators: true }
  );
}

// Decide an application, but only if it is still PENDING (atomic), so two
// admins clicking at the same time can't both decide it. Returns null otherwise.
function decide(id, { status, rejectionReason, reviewedBy }) {
  return VendorProfile.findOneAndUpdate(
    { _id: id, status: 'PENDING' },
    { $set: { status, rejectionReason, reviewedBy, reviewedAt: new Date() } },
    { returnDocument: 'after' }
  );
}

function list(filter, sort, limit) {
  return VendorProfile.find(filter).sort(sort).limit(limit);
}

module.exports = { create, findById, findByUserId, reapply, decide, list };
