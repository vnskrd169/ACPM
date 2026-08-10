"""Rename .btn-add-sm to .btn-add across all files."""
import os

files = ['index.html', 'dashboard.html', 'workspace.html', 'style.css']

total = 0
for fname in files:
    if not os.path.exists(fname):
        print(f'{fname}: SKIPPED (not found)')
        continue
    with open(fname, 'r', encoding='utf-8') as f:
        content = f.read()
    count = content.count('btn-add-sm')
    if count > 0:
        content = content.replace('btn-add-sm', 'btn-add')
        with open(fname, 'w', encoding='utf-8') as f:
            f.write(content)
        total += count
        print(f'{fname}: {count} replacements')
    else:
        print(f'{fname}: 0 matches')

print(f'\nTotal: {total} replacements across {len(files)} files')
