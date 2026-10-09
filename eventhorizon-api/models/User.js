const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },

    //  stops two people from registering with the same email
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },

    // select false means the password is hidden whenever we fetch a user, unless we ask for it
    password: { type: String, required: true, select: false },

    // starts as false becomes true once they click the link in their email
    isVerified: { type: Boolean, default: false },

    // we store a scrambled (hashed) copy of the verification token, never the real one
    verificationTokenHash: String,

    // after this time, the verification link stops working
    verificationTokenExpires: Date,
  },
  { timestamps: true } // automatically adds createdAt and updatedAt
);

module.exports = mongoose.model('User', userSchema);