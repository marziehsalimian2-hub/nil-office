// =============================================================================
// NIL Office — upload validation tests (FIX 5).
// Pure-function tests for lib/upload-validation.ts (extension allow-list +
// extension/MIME consistency). Browser MIME alone is never authoritative.
//
// Run:  node --experimental-strip-types supabase/tests/upload-validation.test.mjs
// =============================================================================
import {
  validateUpload, MAX_UPLOAD_BYTES, isUuid, checkSignature, signatureCheckable,
} from '../../lib/upload-validation.ts';

let failures = 0;
function check(name, cond) {
  if (cond) console.log('PASS:', name);
  else { failures++; console.error('FAIL:', name); }
}

// Accepted: correct extension, no MIME (browser omitted it) -> allowed by extension.
check('pdf with no MIME accepted', validateUpload('report.pdf', '', 1000).ok === true);
// Accepted: extension + consistent MIME.
check('png with image/png accepted', validateUpload('scan.png', 'image/png', 1000).ok === true);
check('docx with correct MIME accepted',
  validateUpload('c.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 1000).ok === true);
// Rejected: extension not in allow-list (executable renamed).
check('exe rejected', validateUpload('malware.exe', 'application/octet-stream', 1000).ok === false);
check('no extension rejected', validateUpload('noext', 'application/pdf', 1000).ok === false);
// Rejected: extension/MIME mismatch (pdf disguised as image, or spoofed MIME).
check('pdf sent as image/png rejected', validateUpload('a.pdf', 'image/png', 1000).ok === false);
check('exe MIME with .pdf name rejected',
  validateUpload('a.pdf', 'application/x-msdownload', 1000).ok === false);
// Rejected: size limits.
check('empty file rejected', validateUpload('a.pdf', 'application/pdf', 0).ok === false);
check('oversized file rejected', validateUpload('a.pdf', 'application/pdf', MAX_UPLOAD_BYTES + 1).ok === false);
// Accepted: jpg/jpeg both map to image/jpeg.
check('jpeg accepted', validateUpload('p.jpeg', 'image/jpeg', 1000).ok === true);
// Accepted: csv commonly arrives as text/plain.
check('csv as text/plain accepted', validateUpload('data.csv', 'text/plain', 1000).ok === true);

// --- entity id (UUID) validation -------------------------------------------
check('valid UUID accepted', isUuid('a1b2c3d4-e5f6-4a1b-8c2d-1234567890ab') === true);
check('malformed UUID rejected', isUuid('not-a-uuid') === false);
check('empty UUID rejected', isUuid('') === false);

// --- file-signature validation ---------------------------------------------
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);           // %PDF-
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const FAKE = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]);                // MZ (exe)
check('pdf ext is signature-checkable', signatureCheckable('pdf') === true);
check('docx ext not signature-checked', signatureCheckable('docx') === false);
check('valid PDF signature accepted', checkSignature('pdf', PDF) === true);
check('valid PNG signature accepted', checkSignature('png', PNG) === true);
check('valid JPEG signature accepted', checkSignature('jpeg', JPG) === true);
check('MZ bytes with pdf ext rejected', checkSignature('pdf', FAKE) === false);
check('png bytes for jpg ext rejected', checkSignature('jpg', PNG) === false);

console.log(failures === 0 ? '\nAll upload-validation tests passed.' : `\n${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
