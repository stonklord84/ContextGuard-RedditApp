## Devvit Bare Template

A practical [Devvit](https://developers.reddit.com/) app template with few dependencies. A little simpler at the expense of a little code.

## Getting Started

> Make sure you have Node 22 downloaded on your machine before running!

1. Run `npm create devvit@latest --template=bare`
2. Go through the installation wizard. You will need to create a Reddit account and connect it to Reddit Developers.

## Commands

- `npm run playtest [r/sub]`: watches changes, builds, uploads, and installs on Reddit. Accepts an optional subreddit.
- `npm run build`: builds client and server, including esbuild metafiles.
- `npm run clean`: removes build outputs.
- `npm run test`: runs all tests.
- `npm run format`: fixes lints and formatting.
- `npm run lint`: checks lints and formatting.
- `npm run publish`: cleans, builds, uploads, and files a new app review request.

## Features

- A plain Node.js server with front and backend typing.
- Tests using the builtin Node.js test runner.
- Promise misuse linter.
- Formatter and bundler.
- TypeScript project skeleton split by environment (frontend, backend, test, etc).

## Fetch Domains
The following domains are requested for this app:

- 'contextguard-one.vercel.app'

ContextGuard posts a context/fact-check-style comment on video posts, similar in spirit
to Community Notes. When a video post is submitted, the app's server sends the post's
HLS video URL to a custom API (`contextguard-one.vercel.app/api/GenerateVerdict`) that:

1. Downloads the video and uploads it to Google's Gemini API (`gemini-2.5-flash`) for
   analysis, using Gemini's Files API.
2. Extracts any on-screen "@handle" shown in the video (e.g. a public TikTok username visible
   as a watermark).
3. Looks up that handle via SerpAPI (Google Search) to gather public context about the
   account.
4. Uses Gemini with Google Search grounding to generate a summary of the real-world
   context behind the video's content (who/what/event it relates to), with sources.
5. The uploaded video file is explicitly deleted from Google's servers immediately after analysis.
   Nothing is retained on our end or Google's beyond the request lifecycle.
6. Returns a summary that the app posts as a distinguished (mod) comment on the
   original post.

This can't be built with Devvit's built-in capabilities because it requires spawning
ffmpeg (a native binary, via child_process) to download and transcode the Reddit-hosted
HLS stream before it can be uploaded to Gemini's Files API — Devvit's server permission
model has no capability for native binary execution. The custom domain is the minimum
external surface needed to run that step.