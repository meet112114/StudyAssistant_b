import mongoose from "mongoose";
import bcrypt from "bcrypt";

const UserSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    password: {
      type: String,
      required: true,
    },

    role: {
      type: String,
      enum: ["admin", "student"],
      default: "student",
    },

    isVerified: {
      type: Boolean,
      default: false,
    },

    avatar: {
      type: String,
    },

    isBlocked: {
      type: Boolean,
      default: false,
    },

    rollNumber: {
      type: String,
      trim: true,
    },

    aiUsage: {
      inputTokens: { type: Number, default: 0 },
      outputTokens: { type: Number, default: 0 }
    },
    credits: {
      balance: { type: Number, default: -1 },         

      totalPurchased: { type: Number, default: 0 },   
      totalUsed: { type: Number, default: 0 },        
      lastRechargedAt: { type: Date, default: null },  

      transactions: [
        {
          type: {
            type: String,
            enum: ["credit", "debit"],
            required: true,
          },
          amount: { type: Number, required: true },       // Tokens added or deducted
          amountInRs: { type: Number, required: true },   // Equivalent rupees (1:1)
          description: { type: String, trim: true },      // e.g. "Recharged via Razorpay", "AI query deduction"
          balanceAfter: { type: Number, required: true }, // Snapshot of balance post-transaction
          createdAt: { type: Date, default: Date.now },
        },
      ],
    },
  },
  { timestamps: true }
);

UserSchema.pre("save", async function () {
  if (!this.isModified("password")) return;

  this.password = await bcrypt.hash(this.password, 10);
});

UserSchema.methods.comparePassword = function (password) {
  return bcrypt.compare(password, this.password);
};

// Add credits when user pays (amountInRs → tokens at configured ratio)
UserSchema.methods.addCredits = async function (amountInRs, description = "Manual recharge") {
  const creditsPerRs = parseInt(process.env.CREDITS_PER_RS || "500", 10);
  const tokens = amountInRs * creditsPerRs;

  this.credits.balance += tokens;
  this.credits.totalPurchased += tokens;
  this.credits.lastRechargedAt = new Date();

  this.credits.transactions.push({
    type: "credit",
    amount: tokens,
    amountInRs,
    description,
    balanceAfter: this.credits.balance,
  });

  return this.save();
};

// Deduct credits after AI usage (pass total tokens used) safely handling concurrent requests
UserSchema.methods.deductCredits = async function (tokensUsed, amountInRs, description = "AI usage deduction") {
  const creditsPerRs = parseInt(process.env.CREDITS_PER_RS || "500", 10);
  
  if (typeof amountInRs === 'string') {
    description = amountInRs;
    amountInRs = tokensUsed / creditsPerRs;
  } else if (amountInRs === undefined) {
    amountInRs = tokensUsed / creditsPerRs;
  }

  // 1. Atomic decrement to avoid read-modify-write race conditions
  const user = await this.model('User').findByIdAndUpdate(
    this._id,
    {
      $inc: {
        'credits.balance': -tokensUsed,
        'credits.totalUsed': tokensUsed
      }
    },
    { returnDocument: 'after' } // Returns the updated document with the exact new balance
  );

  // 2. Add transaction log separately
  await this.model('User').updateOne(
    { _id: this._id },
    {
      $push: {
        'credits.transactions': {
          type: "debit",
          amount: tokensUsed,
          amountInRs: amountInRs, 
          description,
          balanceAfter: user.credits.balance,
        }
      }
    }
  );

  // Sync current instance state
  this.credits = user.credits;
  return this;
};

// Check if user has enough credits before an AI call
UserSchema.methods.hasEnoughCredits = function (tokensRequired) {
  return this.credits.balance >= tokensRequired;
};

export default mongoose.model("User", UserSchema);