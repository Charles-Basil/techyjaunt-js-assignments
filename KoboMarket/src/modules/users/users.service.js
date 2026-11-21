const AppError = require('../../utils/AppError');
const userRepository = require('./user.repository');

async function getMe(userId) {
  const user = await userRepository.findById(userId);
  if (!user) throw new AppError('NOT_FOUND', 'User not found', 404);
  return user;
}

// `fields` was validated by users.schemas.updateMeBody, so it can only
// contain firstName, lastName and phone.
async function updateMe(userId, fields) {
  const user = await userRepository.updateProfile(userId, fields);
  if (!user) throw new AppError('NOT_FOUND', 'User not found', 404);
  return user;
}

module.exports = { getMe, updateMe };
