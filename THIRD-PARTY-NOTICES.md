# Third-Party Notices

This project is MIT licensed (see LICENSE). It incorporates adapted material
from the following open-source project, used under its MIT license terms:

## Dayflow

- Source: https://github.com/JerryZLiu/Dayflow
- Used for: the sensitive-application exclusion hints for screen capture
  and screen-context collection
  (`SCREEN_CAPTURE_BLOCKED_BUNDLE_HINTS` / `SCREEN_CAPTURE_BLOCKED_NAME_HINTS`
  in `src/App.tsx`,
  `sensitiveBundleHints` / `sensitiveNameHints` in
  `native/macos/Sources/VoiceLatteSpeechBridge/AppContext.swift`)
- License text:

```
MIT License

Copyright (c) 2025 Jerry Liu

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

## UI components

UI primitives under `src/components/ui/` follow the shadcn/ui pattern (MIT).
Runtime dependencies (npm / Cargo) are resolved from their registries and
remain under their respective licenses.
