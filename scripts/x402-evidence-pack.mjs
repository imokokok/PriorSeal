// Generated from x402-evidence-pack.mts by npm run core:build:operations. Do not edit directly.
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
const PROJECT_ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));
const FORBIDDEN_KEYS = /* @__PURE__ */ new Set([
  "paymentsignature",
  "xpaymentsignature",
  "x402paymentsignature",
  "paymentpayload",
  "privatekey",
  "x402e2eprivatekey"
]);
async function prepareX402EvidencePack(outputDirectory) {
  const directory = await createPrivateDirectory(outputDirectory);
  const files = [];
  let captured = false, completed = false;
  return {
    directory,
    async captureResponse(input) {
      if (captured || completed)
        throw new TypeError("x402 evidence response has already been captured");
      assertSafeEvidence(input.challenge, "payment challenge");
      assertSafeEvidence(input.bundle, "verification bundle");
      assertSafeEvidence(input.settlement, "settlement summary");
      assertRequiredString(
        input.paymentRequiredHeader,
        "payment-required header"
      );
      assertRequiredString(input.receiptId, "receipt ID");
      assertRequiredString(input.resourceUrl, "resource URL");
      files.push(
        await writeProtectedJson(directory, "payment-challenge.json", {
          schema: "priorseal.x402-payment-challenge-evidence.v1",
          capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
          paymentRequiredSha256: sha256(input.paymentRequiredHeader),
          challenge: input.challenge
        }),
        await writeProtectedJson(
          directory,
          "verification-bundle.json",
          input.bundle
        ),
        await writeProtectedJson(directory, "settlement.json", {
          schema: "priorseal.x402-settlement-evidence.v1",
          capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
          receiptId: input.receiptId,
          resourceUrl: input.resourceUrl,
          payer: input.payer,
          requirement: {
            network: input.network,
            asset: input.asset,
            amount: input.amount,
            payTo: input.payTo
          },
          settlement: input.settlement
        })
      );
      captured = true;
    },
    async complete(input) {
      if (!captured || completed)
        throw new TypeError(
          "x402 evidence response must be captured exactly once before completion"
        );
      assertSafeEvidence(input.localVerification, "local verification result");
      assertSafeEvidence(
        input.paymentEvidenceVerification,
        "payment-evidence verification result"
      );
      assertRequiredString(input.receiptId, "receipt ID");
      assertRequiredString(input.resourceUrl, "resource URL");
      assertSha256(input.bundleHash, "bundle hash");
      assertIdentifier(input.paymentEvidenceId, "payment evidence ID");
      files.push(
        await writeProtectedJson(directory, "verification-result.json", {
          schema: "priorseal.x402-local-verification-result.v1",
          verifiedAt: (/* @__PURE__ */ new Date()).toISOString(),
          receiptId: input.receiptId,
          resourceUrl: input.resourceUrl,
          bundleHash: input.bundleHash,
          paymentEvidenceId: input.paymentEvidenceId,
          localVerification: input.localVerification,
          paymentEvidenceVerification: input.paymentEvidenceVerification
        })
      );
      const manifest = await writeProtectedJson(directory, "manifest.json", {
        schema: "priorseal.x402-rehearsal-evidence-pack.v1",
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        receiptId: input.receiptId,
        resourceUrl: input.resourceUrl,
        bundleHash: input.bundleHash,
        paymentEvidenceId: input.paymentEvidenceId,
        files,
        retention: {
          directoryMode: "0700",
          fileMode: "0600",
          rawPaymentSignatureStored: false,
          privateKeyStored: false,
          rawPaymentResponseStored: false
        }
      });
      completed = true;
      return {
        directory,
        manifestPath: resolve(directory, manifest.name),
        files: [...files, manifest]
      };
    }
  };
}
async function createPrivateDirectory(outputDirectory) {
  if (!isAbsolute(outputDirectory))
    throw new TypeError(
      "--evidence-out must be an absolute path outside the repository"
    );
  const directory = resolve(outputDirectory);
  if (isInsideProject(directory))
    throw new TypeError(
      "--evidence-out must be outside the repository to prevent evidence from entering Git"
    );
  const parent = dirname(directory);
  let parentInfo;
  try {
    parentInfo = await lstat(parent);
  } catch {
    throw new TypeError("--evidence-out parent directory must already exist");
  }
  if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink())
    throw new TypeError("--evidence-out parent must be a real directory");
  try {
    await mkdir(directory, { mode: 448 });
  } catch (error) {
    throw new TypeError(
      `--evidence-out must name a new directory: ${message(error)}`
    );
  }
  await chmod(directory, 448);
  await assertPrivateMode(directory, 448);
  return directory;
}
async function writeProtectedJson(directory, name, value) {
  const path = resolve(directory, name);
  if (dirname(path) !== directory)
    throw new TypeError("Invalid evidence filename");
  const content = `${JSON.stringify(value, null, 2)}
`;
  await writeFile(path, content, { encoding: "utf8", mode: 384, flag: "wx" });
  await chmod(path, 384);
  await assertPrivateMode(path, 384);
  return { name, sha256: sha256(content), bytes: Buffer.byteLength(content) };
}
async function assertPrivateMode(path, expectedMode) {
  const info = await stat(path);
  if ((info.mode & 511) !== expectedMode)
    throw new TypeError(
      `Evidence path does not have mode ${expectedMode.toString(8)}`
    );
}
function isInsideProject(path) {
  const value = relative(PROJECT_ROOT, path);
  return value === "" || !value.startsWith(`..${sep}`) && value !== ".." && !isAbsolute(value);
}
function assertSafeEvidence(value, label, path = label, parentKey = "") {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return;
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      assertSafeEvidence(entry, label, `${path}[${index}]`, parentKey);
    }
    return;
  }
  if (typeof value !== "object")
    throw new TypeError(`${label} is not JSON-safe`);
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    const nestedPaymentPayload = normalizedKey === "payload" && (parentKey === "payment" || parentKey === "paymentevidence");
    const nestedPaymentSignature = normalizedKey === "signature" && parentKey === "payment";
    if (FORBIDDEN_KEYS.has(normalizedKey) || nestedPaymentPayload || nestedPaymentSignature)
      throw new TypeError(
        `${label} contains prohibited sensitive field at ${path}.${key}`
      );
    assertSafeEvidence(entry, label, `${path}.${key}`, normalizedKey);
  }
}
function assertRequiredString(value, label) {
  if (typeof value !== "string" || !value)
    throw new TypeError(`${label} is required`);
}
function assertSha256(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value))
    throw new TypeError(`${label} must be a lowercase SHA-256 hex string`);
}
function assertIdentifier(value, label) {
  if (typeof value !== "string" || !/^psp_[0-9a-f]{32}$/.test(value))
    throw new TypeError(`${label} is invalid`);
}
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
function message(error) {
  return error instanceof Error ? error.message.replace(/[\r\n\t]+/g, " ").slice(0, 160) : "unknown error";
}
export {
  prepareX402EvidencePack
};
