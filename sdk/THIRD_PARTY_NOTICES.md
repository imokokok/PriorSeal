# Included software notices

## Insight RWA assessment

The opt-in `insight-rwa`, `insight-rwa-call` and `insight-rwa-v2` modules are vendored
from Insight's matching `sdk/src/rwa*.ts` modules,
Copyright (c) 2026 Insight, under the MIT license reproduced below.
The joint RWA example checks content-pinned source parity (only relative module
import paths differ), frozen v1/v2 vectors and cross-SDK report digests.
Its separate domain does not replace any historical Insight receipt schema.

## Insight execution receipt verifier

The `insight-execution-v5` module adapts the pure offline execution receipt verifier from Insight, originally at:

https://github.com/imokokok/Insight/blob/76a22ac242512c06cd0e21e3fcd4452867b52e57/verifier/src/execution.ts

It supports the frozen EIP-712 execution layouts and is included in the PriorSeal verifier bundle. PriorSeal adaptations preserve the upstream license below. This inclusion does not publish or replace the separately distributed `verify-insight-receipt` package.

MIT License

Copyright (c) 2026 Insight (oracleinsight.xyz)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
# Insight coverage readiness

`src/insight-coverage.ts` is vendored from the MIT-licensed Insight coverage v1
implementation (`imokokok/Insight`, `sdk/src/coverage.ts`). Copyright (c) 2026
Insight. Used for deterministic offline coverage verification; no runtime network
request is made by this verifier.
