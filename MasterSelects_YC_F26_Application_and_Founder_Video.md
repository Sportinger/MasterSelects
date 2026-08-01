# MasterSelects

## Y Combinator Fall 2026 Application and Founder Video Transcript

**Founder:** Roman Kuskowski  
**Company:** MasterSelects  
**Batch:** Fall 2026  
**Submitted:** July 27, 2026

---

# Application

## Founders

### Roman Kuskowski

Profile complete

### Who writes code, or does other technical work on your product? Was any of it done by a non-founder? Please explain.

I'm the only person building this. I do the architecture, the product decisions and the testing, and I use AI agents heavily for the implementation.

The project is open source, so three people outside have contributed: two very small bug fixes, and a friend who built MIDI track support in the audio module. That's the entire non-founder contribution.

### Are you looking for a cofounder?

Yes. I'm mostly a builder. I need someone to own growth and distribution while I keep building the engine. My users are people who make video professionally but without a team: creators, freelancers, small studios. I'd want a co-founder who lives in that world and knows how to reach them where they already are.

### Founder Video

See the transcript in the final section of this document.

## Company

### Company name

MasterSelects

### Describe what your company does in 50 characters or less.

AI-native GPU media editor in the browser

### Company URL, if any

https://github.com/Sportinger/MasterSelects

### Demo Video

Submitted separately with the original YC application. No link was present in the pasted application text.

### Please provide a link to the product, if any.

https://www.masterselects.com

No password required. Sign in with any email via magic link. Five single-use reviewer links follow; each grants 10,000 AI credits:

1. https://www.masterselects.com/credits/claim?code=Kjdc1Iw1UK7FyrcTMNh6jN5JEbYVR-FS_7r5ffMNpYc
2. https://www.masterselects.com/credits/claim?code=GdEo1HUWSFWEH_tttRmyJCz2_-6jXw6fiZrgzGxUGd4
3. https://www.masterselects.com/credits/claim?code=R_5LT1uvZ7WKh32CpDMeo26gayCefhdO-TZi2C7n-hw
4. https://www.masterselects.com/credits/claim?code=EOKKxVO2weRFb_sSWDJ_D5dkC0wrH5Zb2zeudtoCYO8
5. https://www.masterselects.com/credits/claim?code=RXkzvg3psUHwg5yAYWq1Sa0FQD6K7IpXHkW4bg2fdU4

### What is your company going to make? Please describe your product and what it does or will do.

MasterSelects is a professional browser-based media editor where humans and AI work on the same timeline. Users can import media, cut, arrange, composite, apply effects, transcribe, segment, and export without installing software. Normal editing runs locally through WebGPU and WebCodecs, so source files stay on the user’s device. Unlike AI tools that only suggest edits or generate isolated clips, MasterSelects’ agent can directly operate the editor and complete real editing workflows. The manual editor is free and open source; i monetize AI editing, transcription, and media generation through built-in credits.

### Where do you live now, and where would the company be based after YC?

Berlin, Germany / Berlin, Germany

### Explain your decision regarding location.

Berlin is home. I've spent 16 years in its video art and live visuals scene, so my network and my first users are here. I'll be in San Francisco for the batch, and long term the company can be based wherever gives it the best shot.

## Progress

### How far along are you?

Live and usable today at masterselects.com, free and open source: WebGPU compositing engine, multi-track timeline, real-time video/audio/transition effects, WebCodecs export, on-device transcription and segmentation (SAM2), and an AI agent that operates the editor.

Behind the agent sits a separate closed harness, finished and tested this week. It takes a plain-language request plus local analysis data, plans the edit, simulates it against a shadow timeline, verifies the result against the stated goal, and only commits if the verification passes. No clarification questions mid-run.

416 GitHub stars, ~40 daily visitors, all organic. First paying subscribers are live (Stripe);

### How long have each of you been working on this? How much of that has been full-time? Please explain.

7 months. I committed on 125 of the last 210 days, roughly four hours a day, alongside the video-art client work that pays my rent. Never full-time, close to daily. I'll drop the client work entirely for the batch.

### What tech stack are you using, or planning to use, to build this product? Include AI models and AI coding tools you use.

Frontend: React 19, TypeScript, Zustand, Vite. Rendering: WebGPU with 4,600+ lines of custom WGSL shaders, zero-copy compositing.

Video: WebCodecs, mp4box, experimental FFmpeg WASM.

Native: helper tool for yt-dlp downloads and video matting. On-device AI: SAM2 (ONNX Runtime), Whisper (Transformers.js).

External AI: Kie.ai routing GPT + Claude for the in-editor agent and video/image generation.

AI coding tools: agent of choice can drive it directly via MCP. ~20 production dependencies, everything else built from scratch.

### Are people using your product?

Yes

### How many active users or customers do you have? How many are paying? Who is paying you the most, and how much do they pay you?

94 registered accounts, 4 paying subscribers. 19 new signups in the last 30 days and about 40 daily site visitors across 10+ countries.

### Do you have revenue?

yes

### How much revenue do you have?

| Month | Revenue |
|---|---:|
| Jun 2026 | $20 |
| May 2026 | $10 |
| Apr 2026 | $5 |
| Mar 2026 | $0 |
| Feb 2026 | $0 |
| Jan 2026 | $0 |
| Dec 2025 | $0 |
| Nov 2025 | $0 |
| Oct 2025 | $0 |
| Sep 2025 | $0 |

### Where does your revenue come from? If your revenue comes from multiple sources (e.g., multiple products, multiple companies or a mix of consulting and this product), please break down how much is coming from each source.

100% of revenue comes from MasterSelects subscriptions processed through Stripe.

### Anything else you would like us to know regarding your revenue or growth rate?

Unanswered

### If you are applying with the same idea as a previous batch, did anything change? If you applied with a different idea, why did you pivot and what did you learn from the last idea?

Unanswered

### If you have already participated or committed to participate in an incubator, "accelerator" or "pre-accelerator" program, please tell us about it.

Unanswered

## Idea

### Why did you pick this idea to work on? Do you have domain expertise in this area? How do you know people need what you’re making?

16 years of video art and live visuals. I've spent them in After Effects, Resolve, Blender, TouchDesigner, Resolume and Ableton, usually moving one piece of work through four of them. Then AI generation arrived and made it worse instead of better: another handful of sites, each with its own login and its own download folder, and all of it still had to be dragged back into the same old editor before it became a video. That's when it tipped over for me. One place, all of it, in the browser and an agent can actually operate inside it.

Being my own customer is where it started, not why I think it works. I've never marketed it, and people found it anyway: 94 accounts, 19 signups in the last 30 days, visitors from 10+ countries, four paying. Two strangers have sent patches. And I'm still in the Berlin scene I built it for, so I hear what's missing directly.

### Who are your competitors? What do you understand about your business that they don’t?

The default for creators is CapCut; for anything serious the same people open Resolve or Premiere. Both can already be driven by an agent: there are community MCP bridges for Premiere exposing up to 1,027 tools. They mostly don't work, and the tool count is why: a thousand functions and one sentence is not an agent system.

The harness is what I sell. Between the prompt and the timeline sits a closed harness that plans the edit, runs it against a shadow timeline, verifies the result against the stated goal, and commits atomically or not at all. The editor is MIT-licensed and open. The harness is not.

The other camp (ChatCut, OpenChatCut) starts from the agent with a thin timeline underneath and your footage on their servers.

### How do or will you make money? How much could you make?

The editor is MIT-licensed and does the distribution work. The harness that plans, verifies and executes edits is closed, so forking the editor gets you an editor, not the engine behind it.

Revenue is one credit system. The cheap tier is generation: video, image, speech and music via Kie.ai, where the margin is a markup over model cost. The larger share comes from agent runs on the harness, because a long or specialised edit uses the full pipeline of planning, simulation, verification and refinement. That is my own compute, not a reseller margin. Users who prefer to bring their own API keys can do that for free.

Costs stay low by design. Full media never goes to the server. The harness receives local analysis data and returns an edit plan, which MasterSelects assembles on the user's own GPU. No upload, no storage, no server-side rendering, which is what eats the margin at every cloud editor.

An active user burns roughly $30 a month in credits: agent runs on the harness plus generation. That's in the same range as a Descript or Runway subscription, and those don't come with a real editor underneath.

At 100,000 paying users that's $36M a year. There are several hundred million people editing video, so 100,000 of them paying is a small share of a very large number. The editor being free and open source is what makes that reachable, because the thing that has to spread costs nothing to give away.

### Which category best applies to your company?

Media

### If you had any other ideas you considered applying with, please list them. One may be something we’ve been waiting for. Often when we fund people it’s to do something they list here and not in the main application.

The harness as a standalone product.The layer that makes agent editing reliable doesn't have to be tied to my editor. Same contracts, someone else's timeline.

## Equity

### Have you formed ANY legal entity yet?

no

### If you have not formed the company yet, describe the planned equity ownership breakdown among the founders, employees and any other proposed stockholders. If there are multiple founders, be sure to give the proposed equity ownership of each founder and founder title (e.g. CEO). (This question is as much for you as us.)

Not incorporated yet. Roman Kuskowski, sole founder & CEO I plan to reserve a standard option pool for early employees, and would offer meaningful equity to the right co-founder if one joins.

### Have you taken any investment yet?

no

### Are you currently fundraising?

no

## Curious

### What convinced you to apply to Y Combinator? Did someone encourage you to apply? Have you been to any YC events?

I've made video art for most of my adult life, as a craftsman, never as a founder, and I never thought of anything I built as a company. MasterSelects is different. The editor stays free and useful to anyone. The part worth paying for is the agent, and everything I know about how an edit gets built is in there.

What I don't have is a network or a co-founder, and I know those are the two things holding it back, not the product. YC is the fastest way to fix both. Nobody encouraged me; I have no YC connections and haven't been to any events.

### How did you hear about Y Combinator?

Hacker News, years ago. Everyone in tech knows YC.

## Batch Preference

### What batch do you want to apply for?

current

---

# Founder Video Transcript

Hi, my name is Roman Kuskowski and I'm the solo developer of Master Selects.

I'm a video artist by trade and I was working the last sixteen years in the theater and the opera.

Last year I got really annoyed with my workflows because it contains so many different programs and I wanted a solution which combines everything, which I did not find. So I built my own. Master Selects is a full blown media editor which runs entirely inside your browser.

Nothing to download, nothing to install, no backend. Your files will never leave your computer.

It's the one place where you can craft your visions and it's reachable from wherever you are. It also comes with a built in AI workflow. Generating, planning or even editing, it's all in one place.

The AI is not only here to create fancy slop videos but it can also edit the videos the way you want. This is also the business plan. It's free for manual work. You have to pay if AI does the job.

So the AI will make the first draft, but you will make the decisions. Thank you very much.
