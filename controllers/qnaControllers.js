import QnaSet from "../models/QnaSet.js";
import Resource from "../models/Resource.js";
import PDFDocument from "pdfkit";
import {
  answerSingleQuestion,
  answerBatchQuestions,
} from "../utils/generateQnaAnswers.js";

// ── Create a new empty QnA set ────────────────────────────────────────────────
export const createQnaSet = async (req, res) => {
  try {
    const {
      title,
      resourceIds = [],
      metadata = {},
      defaultSettings = {},
      questions = [],
    } = req.body;

    if (!title?.trim()) {
      return res.status(400).json({ message: "Title is required." });
    }

    // Validate resources belong to user
    if (resourceIds.length > 0) {
      const valid = await Resource.countDocuments({
        _id: { $in: resourceIds },
        user: req.user._id,
      });
      if (valid !== resourceIds.length) {
        return res
          .status(403)
          .json({
            message: "One or more resources not found or not owned by you.",
          });
      }
    }

    // Map raw question strings or objects to QnaItem subdocs
    const questionDocs = questions.map((q) => ({
      question: typeof q === "string" ? q : q.question,
      answer: "",
      isAnswered: false,
    }));

    const qnaSet = new QnaSet({
      title: title.trim(),
      user: req.user._id,
      resources: resourceIds,
      questions: questionDocs,
      metadata,
      defaultSettings,
    });

    await qnaSet.save();
    res.status(201).json(qnaSet);
  } catch (err) {
    console.error("[QnA] createQnaSet error:", err);
    res.status(500).json({ message: "Server error creating QnA set." });
  }
};

// ── Get all QnA sets for user (list view) ─────────────────────────────────────
export const getQnaSets = async (req, res) => {
  try {
    const sets = await QnaSet.find({ user: req.user._id })
      .populate("resources", "name type")
      .select("-questions") // exclude large questions array for list view
      .sort({ updatedAt: -1 })
      .lean();
    res.json(sets);
  } catch (err) {
    console.error("[QnA] getQnaSets error:", err);
    res.status(500).json({ message: "Server error fetching QnA sets." });
  }
};

// ── Get a single QnA set (full detail) ───────────────────────────────────────
export const getQnaSetById = async (req, res) => {
  try {
    const qnaSet = await QnaSet.findOne({
      _id: req.params.id,
      user: req.user._id,
    })
      .populate("resources", "name type embeddingCreated")
      .lean();

    if (!qnaSet) return res.status(404).json({ message: "QnA set not found." });
    res.json(qnaSet);
  } catch (err) {
    console.error("[QnA] getQnaSetById error:", err);
    res.status(500).json({ message: "Server error fetching QnA set." });
  }
};

// ── Update title/metadata/defaultSettings/resources of a QnA set ─────────────
export const updateQnaSet = async (req, res) => {
  try {
    const { title, resourceIds, metadata, defaultSettings, isPublic } =
      req.body;

    // Build the $set payload dynamically — only include fields sent by the client
    const setFields = {};
    if (title !== undefined) setFields.title = title.trim();
    if (resourceIds !== undefined) setFields.resources = resourceIds;
    if (defaultSettings !== undefined)
      setFields.defaultSettings = defaultSettings;
    if (isPublic !== undefined) setFields.isPublic = Boolean(isPublic);
    // Merge metadata fields individually so we don't wipe unset keys
    if (metadata !== undefined) {
      if (metadata.description !== undefined)
        setFields["metadata.description"] = metadata.description;
      if (metadata.tags !== undefined)
        setFields["metadata.tags"] = metadata.tags;
      if (metadata.subject !== undefined)
        setFields["metadata.subject"] = metadata.subject;
    }

    if (Object.keys(setFields).length === 0) {
      return res.status(400).json({ message: "No fields to update." });
    }

    const updated = await QnaSet.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { $set: setFields },
      { new: true, runValidators: true },
    ).populate("resources", "name type embeddingCreated");

    if (!updated)
      return res.status(404).json({ message: "QnA set not found." });
    res.json(updated);
  } catch (err) {
    console.error("[QnA] updateQnaSet error:", err);
    res.status(500).json({ message: "Server error updating QnA set." });
  }
};

// ── Delete a QnA set ──────────────────────────────────────────────────────────
export const deleteQnaSet = async (req, res) => {
  try {
    const result = await QnaSet.deleteOne({
      _id: req.params.id,
      user: req.user._id,
    });
    if (result.deletedCount === 0)
      return res.status(404).json({ message: "QnA set not found." });
    res.json({ message: "QnA set deleted." });
  } catch (err) {
    console.error("[QnA] deleteQnaSet error:", err);
    res.status(500).json({ message: "Server error deleting QnA set." });
  }
};

// ── Add questions to a QnA set ────────────────────────────────────────────────
export const addQuestions = async (req, res) => {
  try {
    const { questions } = req.body; // String[] or { question: string }[]
    if (!questions?.length)
      return res.status(400).json({ message: "No questions provided." });

    const qnaSet = await QnaSet.findOne({
      _id: req.params.id,
      user: req.user._id,
    });
    if (!qnaSet) return res.status(404).json({ message: "QnA set not found." });

    const newItems = questions.map((q) => ({
      question: typeof q === "string" ? q : q.question,
      answer: "",
      isAnswered: false,
    }));

    qnaSet.questions.push(...newItems);
    await qnaSet.save();
    res.json(qnaSet);
  } catch (err) {
    console.error("[QnA] addQuestions error:", err);
    res.status(500).json({ message: "Server error adding questions." });
  }
};

// ── Answer a single question with AI ─────────────────────────────────────
export const answerQuestion = async (req, res) => {
  try {
    const { questionId } = req.params;
    const { settings } = req.body;

    const qnaSet = await QnaSet.findOne(
      { _id: req.params.id, user: req.user._id, "questions._id": questionId },
      { "questions.$": 1, resources: 1, defaultSettings: 1 },
    ).lean();
    if (!qnaSet)
      return res
        .status(404)
        .json({ message: "QnA set or question not found." });

    const item = qnaSet.questions[0];
    const effectiveSettings = settings || qnaSet.defaultSettings;

    // Long-running LLM call — happens BEFORE any write
    const answer = await answerSingleQuestion({
      question: item.question,
      resourceIds: qnaSet.resources.map((r) => r.toString()),
      userId: req.user._id,
      settings: effectiveSettings,
    });

    const updated = await QnaSet.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id, "questions._id": questionId },
      {
        $set: {
          "questions.$.answer": answer,
          "questions.$.isAnswered": true,
          "questions.$.answerSettings": effectiveSettings,
        },
      },
      { new: true },
    ).lean();

    const updatedItem = updated?.questions?.find(
      (q) => q._id.toString() === questionId,
    );

    res.json({
      questionId,
      answer,
      item: updatedItem || { ...item, answer, isAnswered: true },
    });
  } catch (err) {
    console.error("[QnA] answerQuestion error:", err);
    const msg = err.message?.includes("Insufficient credits") 
      ? err.message 
      : "Server error answering question.";
    res.status(500).json({ message: msg });
  }
};

// ── Answer ALL unanswered questions in batch ────────────────────────────
export const answerAllQuestions = async (req, res) => {
  try {
    const { settings, onlyUnanswered = true } = req.body;

    // Read-only fetch
    const qnaSet = await QnaSet.findOne(
      { _id: req.params.id, user: req.user._id },
      { questions: 1, resources: 1, defaultSettings: 1 },
    ).lean();
    if (!qnaSet) return res.status(404).json({ message: "QnA set not found." });

    const effectiveSettings = settings || qnaSet.defaultSettings;
    const targets = onlyUnanswered
      ? qnaSet.questions.filter((q) => !q.isAnswered)
      : qnaSet.questions;

    if (targets.length === 0) {
      const full = await QnaSet.findOne({
        _id: req.params.id,
        user: req.user._id,
      }).lean();
      return res.json({ message: "No questions to answer.", qnaSet: full });
    }

    const resourceIds = qnaSet.resources.map((r) => r.toString());

    // Generate all answers (sequential to avoid rate limits)
    const results = await answerBatchQuestions({
      questions: targets.map((q) => q.question),
      resourceIds,
      userId: req.user._id,
      settings: effectiveSettings,
    });

    // Atomic individual writes — one updateOne per question, no version conflicts
    const writeOps = results
      .filter((r) => !r.error && r.answer)
      .map(({ question, answer }) => {
        const target = targets.find((q) => q.question === question);
        if (!target) return null;
        return {
          updateOne: {
            filter: { _id: req.params.id, "questions._id": target._id },
            update: {
              $set: {
                "questions.$.answer": answer,
                "questions.$.isAnswered": true,
                "questions.$.answerSettings": effectiveSettings,
              },
            },
          },
        };
      })
      .filter(Boolean);

    if (writeOps.length > 0) {
      await QnaSet.bulkWrite(writeOps);
    }

    // Return the fresh document
    const updatedSet = await QnaSet.findOne({
      _id: req.params.id,
      user: req.user._id,
    }).lean();
    res.json({
      answered: writeOps.length,
      total: targets.length,
      qnaSet: updatedSet,
    });
  } catch (err) {
    console.error("[QnA] answerAllQuestions error:", err);
    const msg = err.message?.includes("Insufficient credits") 
      ? err.message 
      : "Server error running batch answer.";
    res.status(500).json({ message: msg });
  }
};

// ── Delete a single question from a set ──────────────────────────────────────
export const deleteQuestion = async (req, res) => {
  try {
    const { questionId } = req.params;
    const qnaSet = await QnaSet.findOne({
      _id: req.params.id,
      user: req.user._id,
    });
    if (!qnaSet) return res.status(404).json({ message: "QnA set not found." });

    const item = qnaSet.questions.id(questionId);
    if (!item) return res.status(404).json({ message: "Question not found." });

    item.deleteOne();
    await qnaSet.save();
    res.json({ message: "Question deleted.", qnaSet });
  } catch (err) {
    console.error("[QnA] deleteQuestion error:", err);
    res.status(500).json({ message: "Server error deleting question." });
  }
};

// ── List all public QnA sets (no auth required) ───────────────────────────────
export const getPublicQnaSets = async (req, res) => {
  try {
    const { search = "", page = 1, limit = 20 } = req.query;
    const query = { isPublic: true };
    if (search.trim()) {
      query.$or = [
        { title: { $regex: search.trim(), $options: "i" } },
        { "metadata.description": { $regex: search.trim(), $options: "i" } },
        { "metadata.tags": { $regex: search.trim(), $options: "i" } },
      ];
    }
    const sets = await QnaSet.find(query)
      .populate("resources", "name type")
      .populate("user", "name email")
      .select("-questions") // exclude full Q&A for listing
      .sort({ updatedAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit))
      .lean();

    const total = await QnaSet.countDocuments(query);
    res.json({ sets, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error("[QnA] getPublicQnaSets error:", err);
    res.status(500).json({ message: "Server error fetching public sets." });
  }
};

// ── View a single public QnA set (no auth required) ──────────────────────────
export const getPublicQnaSetById = async (req, res) => {
  try {
    const qnaSet = await QnaSet.findOne({ _id: req.params.id, isPublic: true })
      .populate("resources", "name type")
      .populate("user", "name email")
      .lean();

    if (!qnaSet)
      return res.status(404).json({ message: "Set not found or is private." });
    res.json(qnaSet);
  } catch (err) {
    console.error("[QnA] getPublicQnaSetById error:", err);
    res.status(500).json({ message: "Server error fetching public set." });
  }
};

export const generatePdfFromQna = async (req, res) => {
  try {
    const qnaSet = await QnaSet.findOne({ _id: req.params.id, isPublic: true })
      .populate("resources", "name type")
      .populate("user", "name email")
      .lean();

    if (!qnaSet) return res.status(404).json({ message: "Set Not available " });

    const doc = new PDFDocument({
      margin: 50,
      size: "A4",
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${qnaSet.title}.pdf`,
    );

    doc.pipe(res);

    // Title
    doc.fontSize(22).text(qnaSet.title, { align: "center" });
    doc.moveDown();

    doc
      .fontSize(12)
      .text(`Created By: ${qnaSet.user.name}`)
      .text(`Email: ${qnaSet.user.email}`)
      .text(`Total Questions: ${qnaSet.totalQuestions}`);

    doc.moveDown();

  qnaSet.questions.forEach((item, index) => {
    doc.font("Helvetica-Bold").fontSize(14).fillColor("blue")
       .text(`Q${index + 1}: ${item.question}`);

    doc.moveDown(0.4);

    const lines = (item.answer || "").split("\n");

    lines.forEach((line) => {
      let text = line.trim();
      if (!text) return;

      let isList = false;
      if (text.startsWith("* ") || text.startsWith("- ")) {
        text = text.replace(/^[*|-]\s*/, "");
        isList = true;
      }

      const parts = text.split("**");

      if (parts.length === 1) {
        doc.font("Helvetica").fontSize(11).fillColor("black")
           .text(isList ? `• ${text}` : text, {
             indent: isList ? 15 : 0,
             align: "left",
             lineGap: 3
           });
      } else {
        doc.fontSize(11).fillColor("black");
        if (isList) {
          parts[0] = `• ${parts[0]}`;
        }
        parts.forEach((part, i) => {
          const isBold = i % 2 === 1;
          const isLast = i === parts.length - 1;
          const options = {
            continued: !isLast,
            align: "left",
            lineGap: 3
          };
          if (i === 0 && isList) {
            options.indent = 15;
          }
          doc.font(isBold ? "Helvetica-Bold" : "Helvetica").text(part, options);
        });
      }
      doc.moveDown(0.3);
    });

    doc.moveDown();

    doc.moveTo(50, doc.y)
       .lineTo(550, doc.y)
       .strokeColor("#cccccc")
       .stroke();

    doc.moveDown();
  });

    

    doc.end();
  } catch (e) {
    console.error("[QnA] getPublicQnaSets error:", e);
    res.status(500).json({ message: "Server error fetching public sets." });
  }
};

export const generatePdfFromQnaPrivate = async (req, res) => {
  try {
    const qnaSet = await QnaSet.findOne({ _id: req.params.id, user: req.user._id })
      .populate("resources", "name type")
      .populate("user", "name email")
      .lean();

    if (!qnaSet) return res.status(404).json({ message: "Set Not available" });

    const doc = new PDFDocument({
      margin: 50,
      size: "A4",
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${qnaSet.title}.pdf`,
    );

    doc.pipe(res);

    // Title
    doc.fontSize(22).text(qnaSet.title, { align: "center" });
    doc.moveDown();

    doc
      .fontSize(12)
      .text(`Created By: ${qnaSet.user.name}`)
      .text(`Email: ${qnaSet.user.email}`)
      .text(`Total Questions: ${qnaSet.totalQuestions}`);

    doc.moveDown();

  qnaSet.questions.forEach((item, index) => {
    doc.font("Helvetica-Bold").fontSize(14).fillColor("blue")
       .text(`Q${index + 1}: ${item.question}`);

    doc.moveDown(0.4);

    const lines = (item.answer || "").split("\n");

    lines.forEach((line) => {
      let text = line.trim();
      if (!text) return;

      let isList = false;
      if (text.startsWith("* ") || text.startsWith("- ")) {
        text = text.replace(/^[*|-]\s*/, "");
        isList = true;
      }

      const parts = text.split("**");

      if (parts.length === 1) {
        doc.font("Helvetica").fontSize(11).fillColor("black")
           .text(isList ? `• ${text}` : text, {
             indent: isList ? 15 : 0,
             align: "left",
             lineGap: 3
           });
      } else {
        doc.fontSize(11).fillColor("black");
        if (isList) {
          parts[0] = `• ${parts[0]}`;
        }
        parts.forEach((part, i) => {
          const isBold = i % 2 === 1;
          const isLast = i === parts.length - 1;
          const options = {
            continued: !isLast,
            align: "left",
            lineGap: 3
          };
          if (i === 0 && isList) {
            options.indent = 15;
          }
          doc.font(isBold ? "Helvetica-Bold" : "Helvetica").text(part, options);
        });
      }
      doc.moveDown(0.3);
    });

    doc.moveDown();

    doc.moveTo(50, doc.y)
       .lineTo(550, doc.y)
       .strokeColor("#cccccc")
       .stroke();

    doc.moveDown();
  });

    doc.end();
  } catch (e) {
    console.error("[QnA] generatePdfFromQnaPrivate error:", e);
    res.status(500).json({ message: "Server error generating pdf." });
  }
};
