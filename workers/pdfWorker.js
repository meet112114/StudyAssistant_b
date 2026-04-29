import { parentPort, workerData } from "worker_threads";
import fs from "fs";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
import mammoth from "mammoth";
const pdfParseLib = require("pdf-parse");
const pdfParse = pdfParseLib.default || pdfParseLib;

async function extract() {
    try {
        const { filePath, fileType, isUrl, fileBuffer: incomingBuffer } = workerData;
        let fileBuffer = incomingBuffer;

        if (!fileBuffer) {
            if (isUrl) {
                const response = await fetch(filePath, {
                    headers: { 'User-Agent': 'Mozilla/5.0' }
                });
                if (!response.ok) throw new Error(`Failed to fetch remote file: ${response.statusText}`);
                const arrayBuffer = await response.arrayBuffer();
                fileBuffer = Buffer.from(arrayBuffer);
            } else {
                fileBuffer = fs.readFileSync(filePath);
            }
        }

        let text = "";
        if (fileType === "pdf") {
            const { PDFParse } = pdfParseLib;
            if (PDFParse) {
                const parser = new PDFParse({ data: fileBuffer });
                const result = await parser.getText();
                await parser.destroy();
                text = result.text;
            } else {
                const result = await pdfParseLib(fileBuffer);
                text = result.text;
            }
        } else if (fileType === "docx") {
            const result = await mammoth.extractRawText({ buffer: fileBuffer });
            text = result.value;
        } else if (fileType === "txt") {
            text = fileBuffer.toString("utf-8");
        } else {
            console.warn(`Unsupported extraction type: ${fileType}`);
        }

        parentPort.postMessage({ success: true, text });
    } catch (error) {
        parentPort.postMessage({ success: false, error: error.message });
    }
}

extract();
