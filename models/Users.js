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

    aiUsage: {
      inputTokens: { type: Number, default: 0 },
      outputTokens: { type: Number, default: 0 }
    },
    credits: {
      balance: { type: Number, default: 20 },          // Current token balance (1 Rs = 500 credits)
      totalPurchased: { type: Number, default: 0 },    // Lifetime tokens purchased
      totalUsed: { type: Number, default: 0 },         // Lifetime tokens consumed
      lastRechargedAt: { type: Date, default: null },  // Last top-up timestamp

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

// Add credits when user pays (amountInRs → tokens at 1:500)
UserSchema.methods.addCredits = async function (amountInRs, description = "Manual recharge") {
  const tokens = amountInRs * 500; // 1 Rs = 500 tokens

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

// Deduct credits after AI usage (pass total tokens used)
UserSchema.methods.deductCredits = async function (tokensUsed, amountInRs, description = "AI usage deduction") {
  if (typeof amountInRs === 'string') {
    description = amountInRs;
    amountInRs = tokensUsed / 500;
  } else if (amountInRs === undefined) {
    amountInRs = tokensUsed / 500;
  }

  // We now allow balance to go negative so the transaction is recorded.
  // The pre-check in llmProvider.js will prevent future generations.

  this.credits.balance -= tokensUsed;
  this.credits.totalUsed += tokensUsed;

  this.credits.transactions.push({
    type: "debit",
    amount: tokensUsed,
    amountInRs: amountInRs, 
    description,
    balanceAfter: this.credits.balance,
  });

  return this.save();
};

// Check if user has enough credits before an AI call
UserSchema.methods.hasEnoughCredits = function (tokensRequired) {
  return this.credits.balance >= tokensRequired;
};

export default mongoose.model("User", UserSchema);