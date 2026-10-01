# Third-party notices

Parts of `src/client/renderer.tsx`, `src/client/shiki.ts`, `src/client/styles.css`,
`tsdown.config.ts` and `tests/plugin.spec.tsx` are derived from
[dsh-better-markdown](https://github.com/zerob13/dsh-better-markdown):

```
MIT License

Copyright (c) 2026 duskzhen

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
```

The side-question feature (`src/side-question.ts`, `src/client/side-questions.ts`) and the
selection toolbar (`src/client/selection-ui.tsx`) follow the design of
[dsh-btw](https://github.com/MichengAI/dsh-btw) by MichengAI (a tool-less fork subagent behind
hidden commands, a tool guard, a toolbar over transcript selections). The code was written anew
for this package; dsh-btw is licensed under the Apache License, Version 2.0
(https://www.apache.org/licenses/LICENSE-2.0).
