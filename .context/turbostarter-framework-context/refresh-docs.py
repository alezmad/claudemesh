#!/usr/bin/env python3
"""
TurboStarter Documentation Chunker

Downloads llms.txt from TurboStarter and splits it into organized markdown files.
Creates an index.md with navigation and a CLAUDE.md context file.

Usage:
    python refresh-docs.py

Or make executable:
    chmod +x refresh-docs.py
    ./refresh-docs.py
"""

import os
import re
import urllib.request
from pathlib import Path
from datetime import datetime
from collections import defaultdict

# Configuration
LLMS_URL = "https://www.turbostarter.dev/llms.txt"
DOCS_DIR = Path(__file__).parent
OUTPUT_DIR = DOCS_DIR / "sections"

def download_llms_txt():
    """Download the latest llms.txt from TurboStarter."""
    print(f"Downloading from {LLMS_URL}...")
    with urllib.request.urlopen(LLMS_URL) as response:
        content = response.read().decode('utf-8')

    # Save full file
    full_path = DOCS_DIR / "llms-full.txt"
    full_path.write_text(content)
    print(f"Saved full file to {full_path} ({len(content)} bytes)")
    return content

def parse_frontmatter(text):
    """Extract YAML frontmatter from a document section."""
    match = re.match(r'^---\s*\n(.*?)\n---\s*\n', text, re.DOTALL)
    if not match:
        return None, text

    frontmatter = {}
    for line in match.group(1).strip().split('\n'):
        if ':' in line:
            key, value = line.split(':', 1)
            frontmatter[key.strip()] = value.strip()

    content = text[match.end():]
    return frontmatter, content

def url_to_path(url):
    """Convert URL path to filesystem path."""
    # /docs/web/database -> web/database
    path = url.lstrip('/')
    if path.startswith('docs/'):
        path = path[5:]
    return path

def chunk_docs(content):
    """Split llms.txt into individual documents."""
    # Split by document separator (--- at start of line followed by url:)
    sections = re.split(r'\n(?=---\s*\nurl:)', content)

    docs = []
    for section in sections:
        section = section.strip()
        if not section:
            continue

        frontmatter, body = parse_frontmatter(section)
        if frontmatter and 'url' in frontmatter:
            docs.append({
                'url': frontmatter.get('url', ''),
                'title': frontmatter.get('title', 'Untitled'),
                'description': frontmatter.get('description', ''),
                'content': body.strip(),
                'path': url_to_path(frontmatter.get('url', ''))
            })

    return docs

def organize_by_category(docs):
    """Group documents by their top-level category."""
    categories = defaultdict(list)
    for doc in docs:
        parts = doc['path'].split('/')
        if parts:
            category = parts[0]  # web, mobile, extension, etc.
            categories[category].append(doc)
    return dict(categories)

def save_docs(docs):
    """Save chunked documents to filesystem."""
    # Clean output directory
    if OUTPUT_DIR.exists():
        import shutil
        shutil.rmtree(OUTPUT_DIR)
    OUTPUT_DIR.mkdir(parents=True)

    # Group by category
    categories = organize_by_category(docs)

    saved_files = []
    for category, category_docs in categories.items():
        category_dir = OUTPUT_DIR / category
        category_dir.mkdir(parents=True, exist_ok=True)

        for doc in category_docs:
            # Create subdirectories if needed
            path_parts = doc['path'].split('/')
            if len(path_parts) > 1:
                subdir = category_dir / '/'.join(path_parts[1:-1]) if len(path_parts) > 2 else category_dir
                subdir.mkdir(parents=True, exist_ok=True)
                filename = path_parts[-1] + '.md'
                filepath = subdir / filename
            else:
                filepath = category_dir / 'index.md'

            # Build markdown content
            md_content = f"""---
title: {doc['title']}
description: {doc['description']}
url: {doc['url']}
---

# {doc['title']}

{doc['content']}
"""
            filepath.write_text(md_content)
            saved_files.append({
                'filepath': filepath.relative_to(DOCS_DIR),
                'title': doc['title'],
                'description': doc['description'],
                'url': doc['url'],
                'category': category
            })

    print(f"Saved {len(saved_files)} documentation files")
    return saved_files, categories

def generate_index(saved_files, categories, docs):
    """Generate index.md with rich contextual navigation."""
    lines = [
        "# TurboStarter Documentation Index",
        "",
        f"**Last updated:** {datetime.now().strftime('%Y-%m-%d %H:%M')}  ",
        f"**Total pages:** {len(docs)}  ",
        f"**Source:** https://www.turbostarter.dev/llms.txt",
        "",
        "---",
        "",
        "## Quick Reference",
        "",
        "Use this index to find TurboStarter documentation. Each link includes a description.",
        "",
    ]

    # Category overview with counts and key topics
    lines.append("### Categories Overview")
    lines.append("")
    lines.append("| Platform | Pages | Key Topics |")
    lines.append("|----------|-------|------------|")

    for category in sorted(categories.keys()):
        count = len(categories[category])
        # Extract unique subcategories as key topics
        subcats = set()
        for doc in categories[category]:
            parts = doc['path'].split('/')
            if len(parts) > 1:
                subcats.add(parts[1])
        topics = ', '.join(sorted(subcats)[:5])
        if len(subcats) > 5:
            topics += f' (+{len(subcats)-5} more)'
        lines.append(f"| **{category.title()}** | {count} | {topics} |")

    lines.append("")
    lines.append("---")
    lines.append("")

    # Detailed sections with full context
    for category in sorted(categories.keys()):
        lines.append(f"## {category.title()}")
        lines.append("")

        # Group by subcategory
        subcats = defaultdict(list)
        for doc in categories[category]:
            parts = doc['path'].split('/')
            subcat = parts[1] if len(parts) > 1 else 'overview'
            subcats[subcat].append(doc)

        for subcat in sorted(subcats.keys()):
            subcat_title = subcat.replace('-', ' ').replace('_', ' ').title()
            lines.append(f"### {subcat_title}")
            lines.append("")

            # Add a contextual summary based on descriptions
            subcat_docs = subcats[subcat]
            if len(subcat_docs) > 3:
                lines.append(f"*{len(subcat_docs)} pages covering {subcat_title.lower()} functionality.*")
                lines.append("")

            # Table format for better scanning
            lines.append("| Topic | Description |")
            lines.append("|-------|-------------|")
            for doc in sorted(subcat_docs, key=lambda d: d['title']):
                filepath = f"sections/{doc['path']}.md"
                # Truncate long descriptions
                desc = doc['description'][:80] + '...' if len(doc['description']) > 80 else doc['description']
                lines.append(f"| [{doc['title']}]({filepath}) | {desc} |")

            lines.append("")

    # Quick lookup section
    lines.append("---")
    lines.append("")
    lines.append("## Quick Lookup by Keyword")
    lines.append("")
    lines.append("Common searches and where to find them:")
    lines.append("")

    # Build keyword index from titles and descriptions
    keyword_map = defaultdict(list)
    keywords_of_interest = [
        'auth', 'login', 'oauth', 'session',
        'database', 'drizzle', 'postgres', 'migration',
        'api', 'hono', 'endpoint', 'route',
        'billing', 'stripe', 'payment', 'subscription',
        'email', 'smtp', 'template',
        'storage', 's3', 'upload', 'file',
        'i18n', 'translation', 'locale',
        'admin', 'user', 'role', 'permission',
        'organization', 'team', 'member',
        'ai', 'openai', 'anthropic', 'chat',
        'deploy', 'vercel', 'docker',
        'test', 'vitest', 'playwright',
    ]

    for doc in docs:
        text = f"{doc['title']} {doc['description']}".lower()
        for kw in keywords_of_interest:
            if kw in text:
                keyword_map[kw].append(doc)

    # Output keyword table
    lines.append("| Keyword | Related Docs |")
    lines.append("|---------|--------------|")
    for kw in sorted(keyword_map.keys()):
        related = keyword_map[kw][:3]  # Max 3 per keyword
        links = ', '.join([f"[{d['title']}](sections/{d['path']}.md)" for d in related])
        if len(keyword_map[kw]) > 3:
            links += f" (+{len(keyword_map[kw])-3} more)"
        lines.append(f"| `{kw}` | {links} |")

    lines.append("")

    index_path = DOCS_DIR / "index.md"
    index_path.write_text('\n'.join(lines))
    print(f"Generated index at {index_path}")

def generate_claude_md():
    """Generate CLAUDE.md context file for the docs folder."""
    content = """# TurboStarter Framework Context

TurboStarter framework documentation for AI context loading.

## When to Read More

**Read `index.md`** if you need to:
- Find TurboStarter documentation on a specific topic
- Search by keyword (auth, database, billing, api, etc.)
- Understand what documentation is available

**Read `framework.md`** for:
- pnpm commands and workflows
- Monorepo structure
- Code conventions

## Quick Reference

| Need | Read |
|------|------|
| Commands & patterns | `framework.md` |
| Authentication | `sections/web/auth/` |
| Database/Drizzle | `sections/web/database/` |
| API/Hono | `sections/web/api/` |
| Billing/Stripe | `sections/web/billing/` |
| UI Components | `sections/web/ui/` |
| Organizations | `sections/web/organizations/` |
| i18n | `sections/web/i18n/` |
| Mobile | `sections/mobile/` |

## Refreshing

```bash
python .context/turbostarter-framework-context/refresh-docs.py
```

## Notes

- These docs are **subordinate** to `.context/CLAUDE.md`
- Adapt patterns to match existing codebase, don't copy verbatim
- When in doubt, check the actual code in `packages/` and `apps/`
"""

    claude_path = DOCS_DIR / "CLAUDE.md"
    claude_path.write_text(content)
    print(f"Generated CLAUDE.md at {claude_path}")

def main():
    print("=" * 60)
    print("TurboStarter Documentation Chunker")
    print("=" * 60)
    print()

    # Download latest docs
    content = download_llms_txt()

    # Parse and chunk
    print("Parsing documentation sections...")
    docs = chunk_docs(content)
    print(f"Found {len(docs)} documentation pages")

    # Save to filesystem
    print("Saving chunked files...")
    saved_files, categories = save_docs(docs)

    # Generate navigation files
    print("Generating navigation files...")
    generate_index(saved_files, categories, docs)
    generate_claude_md()

    print()
    print("=" * 60)
    print("Done! Documentation is ready in .context/turbostarter-framework-context/")
    print("=" * 60)

if __name__ == "__main__":
    main()
