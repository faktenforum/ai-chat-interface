/**
 * MCP Prompt: File Conversion
 *
 * LLM-optimized reference for converting images, audio, video,
 * and documents between formats using CLI tools.
 */

export const FILE_CONVERSION_PROMPT = {
  name: 'file_conversion',
  description: 'CLI reference for converting images (ImageMagick), audio/video (FFmpeg), and documents (Pandoc) between formats',
  content: `# File Format Conversion

## Workflow

1. **Upload** — \`create_upload_session\` → user uploads file → lands in \`uploads/\`.
2. **Identify** — \`file uploads/input.*\` to confirm format; check extension.
3. **Convert** — run the appropriate CLI tool (see sections below).
4. **Return** — \`read_workspace_file\` for images/audio (up to 10 MB inline). \`create_download_link\` for video or large files.

Save all output inside the workspace so tools can access it.

---

## Images — ImageMagick 6

The installed version is ImageMagick 6. Use \`convert\` (not \`magick\`).

\`\`\`bash
# Basic conversion (format inferred from extension)
convert uploads/input.png uploads/output.webp

# With quality (1-100, lower = smaller)
convert uploads/input.jpg -quality 85 uploads/output.webp

# Resize (fit within bounds, preserve aspect ratio)
convert uploads/input.png -resize 800x600 uploads/output.png

# Resize to exact dimensions (may distort)
convert uploads/input.png -resize 800x600! uploads/output.png

# Convert and strip metadata
convert uploads/input.jpg -strip uploads/output.jpg

# Batch convert all PNGs to WEBP
for f in uploads/*.png; do convert "$f" "\${f%.png}.webp"; done

# PDF to images (one PNG per page)
convert -density 150 uploads/input.pdf uploads/page-%03d.png

# Images to PDF
convert uploads/page-*.png uploads/output.pdf
\`\`\`

**Supported formats:** PNG, JPG/JPEG, WEBP, GIF, BMP, TIFF, SVG, ICO, AVIF, HEIC, PDF, and many more.

---

## Audio — FFmpeg

\`\`\`bash
# WAV → MP3 (high quality VBR)
ffmpeg -i uploads/input.wav -codec:a libmp3lame -qscale:a 2 uploads/output.mp3

# Any → OGG Vorbis
ffmpeg -i uploads/input.wav -codec:a libvorbis -qscale:a 5 uploads/output.ogg

# Any → FLAC (lossless)
ffmpeg -i uploads/input.wav -codec:a flac uploads/output.flac

# Any → OPUS (excellent compression)
ffmpeg -i uploads/input.wav -codec:a libopus -b:a 128k uploads/output.opus

# Any → AAC/M4A
ffmpeg -i uploads/input.wav -codec:a aac -b:a 192k uploads/output.m4a

# MP3 → WAV (decode to uncompressed)
ffmpeg -i uploads/input.mp3 uploads/output.wav

# Extract audio from video
ffmpeg -i uploads/input.mp4 -vn -codec:a libmp3lame -qscale:a 2 uploads/output.mp3

# Change sample rate
ffmpeg -i uploads/input.wav -ar 44100 uploads/output.wav

# Trim audio (start at 30s, duration 60s)
ffmpeg -i uploads/input.mp3 -ss 30 -t 60 -codec copy uploads/output.mp3
\`\`\`

**Common codecs:** libmp3lame (MP3), libvorbis (OGG), flac (FLAC), libopus (OPUS), aac (AAC/M4A).

---

## Video — FFmpeg

\`\`\`bash
# Any → MP4 (H.264 + AAC, widely compatible)
ffmpeg -i uploads/input.mov -c:v libx264 -c:a aac uploads/output.mp4

# Any → WEBM (VP9 + Opus, web-optimized)
ffmpeg -i uploads/input.mp4 -c:v libvpx-vp9 -c:a libopus uploads/output.webm

# Compress with CRF (lower = better quality, 18-28 typical)
ffmpeg -i uploads/input.mp4 -c:v libx264 -crf 23 -c:a aac uploads/output.mp4

# Scale/resize video
ffmpeg -i uploads/input.mp4 -vf scale=1280:720 -c:a copy uploads/output.mp4

# Scale to width, auto height (keep aspect ratio)
ffmpeg -i uploads/input.mp4 -vf scale=1280:-2 -c:a copy uploads/output.mp4

# Video → animated GIF (10 fps, 480px wide)
ffmpeg -i uploads/input.mp4 -vf "fps=10,scale=480:-1" uploads/output.gif

# Trim video (start 10s, duration 30s, no re-encode)
ffmpeg -i uploads/input.mp4 -ss 10 -t 30 -c copy uploads/output.mp4

# Remove audio
ffmpeg -i uploads/input.mp4 -an -c:v copy uploads/output.mp4
\`\`\`

**Common video codecs:** libx264 (H.264/MP4), libx265 (HEVC), libvpx-vp9 (VP9/WEBM).
Always use \`-y\` flag to overwrite without prompting: \`ffmpeg -y -i ...\`.

---

## Documents — Pandoc

\`\`\`bash
# Markdown → HTML
pandoc uploads/input.md -o uploads/output.html

# Markdown → ODT (recommended open editable format)
pandoc uploads/input.md -o uploads/output.odt

# Markdown → DOCX
pandoc uploads/input.md -o uploads/output.docx

# Markdown → EPUB
pandoc uploads/input.md -o uploads/output.epub

# HTML → Markdown
pandoc uploads/input.html -o uploads/output.md

# With styling template (ODT or DOCX)
pandoc uploads/input.md --reference-doc=uploads/template.odt -o uploads/output.odt

# Standalone HTML (includes head/body)
pandoc uploads/input.md -s -o uploads/output.html
\`\`\`

**Supported formats:** Markdown, HTML, ODT, DOCX, EPUB, RST, LaTeX, man, plain text, and more.
For PDF generation, prefer **Typst** (see Dokumenten-Ersteller agent or MCP prompt \`document_creation\`).

---

## Constraints

- **Save inside workspace** — all output paths must be within the workspace.
- **Video/large files** — always use \`create_download_link\`; they exceed the 10 MB inline limit.
- **Images/audio** — use \`read_workspace_file\` to show inline in chat (up to 10 MB); offer \`create_download_link\` additionally. Note: \`read_workspace_file\` supports PNG, JPG, GIF inline display — WEBP is **not** supported for inline preview (use \`create_download_link\` instead).
- **Overwrite** — use \`ffmpeg -y\` to avoid interactive prompts.
`,
};
