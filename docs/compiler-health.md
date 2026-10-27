# React Compiler health

Measured on Boat on 2026-10-27 from main `54e582e`, with the pinned Babel 7.29.7 / React Compiler 1.0.0 and React 19 target. Run `pnpm quality:compiler` on your Boat to regenerate `.review-artifacts/code-quality/compiler-events.json` and `compiler-bailouts.md`. The script uses existing dev dependencies and does not alter source.

The isolated logger scanned **191 files**, recording **348 CompileSuccess** events and **18 CompileError** events across **13 files**. No pipeline errors occurred. The official `react-compiler-healthcheck` separately reported **324/324 components**, StrictMode usage and no incompatible libraries. Its component count and this logger’s event count should not be compared as a single success ratio.

| File | Events |
| --- | --- |
| src/client/Viewer.tsx | CompileError:70 Existing memoization could not be preserved; CompileError:70 Existing memoization could not be preserved; CompileError:70 Existing memoization could not be preserved; CompileError:70 Existing memoization could not be preserved |
| src/client/comments/CommentsPanel.tsx | CompileError:149 (BuildHIR::lowerStatement) Handle TryStatement with a finalizer ('finally') clause |
| src/client/comparison/ComparisonWorkspace.tsx | CompileError:131 Unexpected terminal kind `logical` for ternary test block |
| src/client/components/animated-icon.tsx | CompileError:64 (BuildHIR::lowerExpression) Handle ??= operators in AssignmentExpression |
| src/client/components/animated-number.tsx | CompileError:42 Cannot access refs during render |
| src/client/editor/Editor.tsx | CompileError:242 (BuildHIR::lowerStatement) Handle TryStatement without a catch clause |
| src/client/index/PluginSlots.tsx | CompileError:96 Support value blocks (conditional, logical, optional chaining, etc) within a try/catch statement |
| src/client/plugins/PluginUi.tsx | CompileError:157 Support value blocks (conditional, logical, optional chaining, etc) within a try/catch statement |
| src/client/settings/AgentCredentials.tsx | CompileError:110 (BuildHIR::lowerStatement) Handle TryStatement with a finalizer ('finally') clause; CompileError:144 (BuildHIR::lowerStatement) Handle TryStatement with a finalizer ('finally') clause; CompileError:146 (BuildHIR::lowerStatement) Support ThrowStatement inside of try/catch |
| src/client/upload/UploadReplay.tsx | CompileError:173 (BuildHIR::lowerStatement) Handle TryStatement with a finalizer ('finally') clause |
| src/client/video-export.ts | CompileError:229 Support value blocks (conditional, logical, optional chaining, etc) within a try/catch statement |
| src/client/viewer/Performance.tsx | CompileError:452 This value cannot be modified |
| src/client/viewer/Scrubber.tsx | CompileError:154 (BuildHIR::lowerExpression) Handle \|\|= operators in AssignmentExpression |

The application has `reactCompilerPreset()` in `vite.config.ts`. Storybook points its builder at that config; its effective compiler configuration still needs verification after its active changes merge. Vitest has no explicit compiler transform, and the recorder uses esbuild. Enabling those transforms requires checking hook behavior and recorder bundle/API parity against the application build. These areas are actively owned, and this report does not establish that parity, so their configuration is deferred. Bailouts remain report-only; logger/parser/pipeline failures fail the command.
