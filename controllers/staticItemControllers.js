import fs from "fs";
import path from "path";
import StaticItem from "../models/StaticItem.js";

const staticDir = path.join(process.cwd(), "public", "static-files");
if (!fs.existsSync(staticDir)) {
  fs.mkdirSync(staticDir, { recursive: true });
}

// 1. Get all items in a directory and calculate breadcrumbs
export const getItems = async (req, res) => {
  try {
    const parentId = req.query.parentId === "null" || !req.query.parentId ? null : req.query.parentId;

    const items = await StaticItem.find({ parentId })
      .populate("uploadedBy", "name email")
      .sort({ type: 1, name: 1 }); // Folders first, then files alphabetically

    // Compute breadcrumbs path
    const breadcrumbs = [];
    let currentId = parentId;
    while (currentId) {
      const folder = await StaticItem.findById(currentId);
      if (!folder) break;
      breadcrumbs.unshift({ _id: folder._id, name: folder.name });
      currentId = folder.parentId;
    }
    breadcrumbs.unshift({ _id: null, name: "Root" });

    res.status(200).json({ items, breadcrumbs });
  } catch (error) {
    console.error("Error in getItems:", error);
    res.status(500).json({ message: "Server error fetching files and folders." });
  }
};

// 2. Create a folder
export const createFolder = async (req, res) => {
  try {
    const { name, parentId } = req.body;
    const resolvedParentId = parentId || null;

    if (!name || name.trim() === "") {
      return res.status(400).json({ message: "Folder name is required." });
    }

    // Check if duplicate exists
    const existing = await StaticItem.findOne({
      name: name.trim(),
      parentId: resolvedParentId,
      type: "folder",
    });

    if (existing) {
      return res.status(400).json({ message: "A folder with this name already exists here." });
    }

    const folder = new StaticItem({
      name: name.trim(),
      type: "folder",
      parentId: resolvedParentId,
      uploadedBy: req.user._id,
    });

    await folder.save();
    res.status(201).json(folder);
  } catch (error) {
    console.error("Error creating folder:", error);
    res.status(500).json({ message: "Server error creating folder." });
  }
};

// 3. Upload a file
export const uploadFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded." });
    }

    const parentId = req.body.parentId === "null" || !req.body.parentId ? null : req.body.parentId;

    // Check if duplicate file exists in the current folder
    const existing = await StaticItem.findOne({
      name: req.file.originalname,
      parentId,
      type: "file",
    });

    if (existing) {
      // Remove local uploaded file to prevent cluttering
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({ message: "A file with this name already exists here." });
    }

    const fileItem = new StaticItem({
      name: req.file.originalname,
      type: "file",
      parentId,
      url: `/static-files/${req.file.filename}`,
      size: req.file.size,
      mimeType: req.file.mimetype,
      uploadedBy: req.user._id,
    });

    await fileItem.save();
    res.status(201).json(fileItem);
  } catch (error) {
    console.error("Error uploading file:", error);
    // Cleanup file in case of crash/error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ message: "Server error uploading file." });
  }
};

// Recursive helper to delete static item
const deleteItemRecursive = async (itemId) => {
  const item = await StaticItem.findById(itemId);
  if (!item) return;

  if (item.type === "file") {
    // Delete file locally from disk
    if (item.url && item.url.startsWith("/static-files/")) {
      const fileName = item.url.replace("/static-files/", "");
      const filePath = path.join(staticDir, fileName);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
    await StaticItem.findByIdAndDelete(itemId);
  } else if (item.type === "folder") {
    // Recursively find and delete all children
    const children = await StaticItem.find({ parentId: itemId });
    for (const child of children) {
      await deleteItemRecursive(child._id);
    }
    await StaticItem.findByIdAndDelete(itemId);
  }
};

// 4. Delete an item (recursive)
export const deleteItem = async (req, res) => {
  try {
    const { id } = req.params;
    const item = await StaticItem.findById(id);

    if (!item) {
      return res.status(404).json({ message: "Item not found." });
    }

    await deleteItemRecursive(id);
    res.status(200).json({ message: "Item and all its contents deleted successfully." });
  } catch (error) {
    console.error("Error deleting static item:", error);
    res.status(500).json({ message: "Server error deleting item." });
  }
};
