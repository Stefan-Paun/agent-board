# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack
Plain Node (no dependencies) for collector and server; static HTML/CSS/JS with Canvas and WebAudio in the browser. No build step.

## Users
Developers who run long multi-agent Claude Code sessions and want to watch them while they run, on a desktop browser or a phone (e.g. via Tailscale).

## Product Purpose
Agent-Board shows a running Claude Code session as a small pixel-art apartment seen from above: Claude sits at a desk in the living room in the middle, every subagent is a little pixel person who walks through a door into whichever room matches the tool it's using (the door visibly opens while the room is occupied). Success: the user sees at a glance who is working, on what, who finished, and who failed, and can hand quick commands to the chat via buttons.

## Positioning
A cozy, legible, pixel-art live board for Claude Code agents, driven by Claude Code hook events. Existing observability tools are event logs; this one is a little apartment you can glance at.

## Operating Context
Events come from Claude Code hooks (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, SubagentStart, SubagentStop, Stop, Notification, SessionEnd). A hook script appends reduced records to a local JSONL file; a loopback-only Node server streams them to the page over SSE.

## Capabilities and Constraints
- Read-only observation plus command buttons that copy text to the clipboard for the user to paste into the chat (no real remote control in v1; hooks cannot push into a running session).
- Stations are derived from tool use (Read/Grep/Glob, Edit/Write, Bash, Web, Agent/Task). Rounds' 4 phases are not in the events, so they are not shown.
- Prompts are never stored, only that one happened. Tool targets are shortened and long token-like strings redacted.
- Server binds to 127.0.0.1 only and checks the Host header.
- German UI text (Austrian).

## Brand Commitments
True pixel art, bird's-eye (top-down) view: the whole scene renders into a small low-resolution buffer and is upscaled with nearest-neighbor (no smoothing), so edges stay crisp and blocky rather than soft vector shapes. Floor-plan apartment: 6 rooms in one building behind a shared outer wall with windows (3 in a row above the living room, 3 below), each room a real rectangle with its own walls and a door that visibly slides open while occupied — not stations scattered on an open floor. Each room is richly furnished (multiple pieces, rugs, wall decor, clutter), not a single icon. A sixth room, the Pausenraum (break room, sofa/bookshelf/window), is where finished subagents go to rest instead of floating in the open living room. Cream/terracotta/sage palette carries over from the cozy-office round. Station labels stay their original technical names (Archiv, Werkstatt, Terminal, Funkturm, Leitstand) even though the rooms read as apartment spaces; Pausenraum has no matching tool and is reached only via the done-state. Subagents named plainly "Agent 1", "Agent 2", ... No XP/level/rank system — only current state and activity. Text (names, labels, status badges) stays crisp/un-pixelated for readability; only the scene art (floor, walls, furniture, people) is pixelated. Sound effects stay (synthesized, off until the user switches them on), but modest. The author pinned the cozy-office direction on 2026-10-08, then asked for the apartment layout with doors and bird's-eye view the same day, then explicitly chose true pixel art over "more detail in the existing soft-illustration style," then asked for the break room and much richer per-room detail (built via three parallel subagents, one per room pair, merged by hand) — replacing the earlier sci-fi command-map world (kept only as git history, not as a toggleable alternate skin).

## Evidence on Hand
No recorded real sessions yet; a built-in demo mode simulates events for testing.

## Product Principles
- The map is the product; a log is secondary.
- Honest about what hooks can and cannot show.
- Nothing sensitive leaves the machine; nothing stored that is not needed.
