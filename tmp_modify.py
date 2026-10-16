path = r'c:\Users\ALMUSTAFA\Desktop\مشاريع المواقع\AlfaClass-main\index.html'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

old = '''function pollVoterAvatarHtml(key, label) {
  const photo = pollVoterPhoto(key);
  const safeLabel = sanitizeText(label || '').replace(/"/g, '&quot;');
  if (photo) {
    return `<img class="poll-voter-img" src="${sanitizeText(photo).replace(/"/g, '&quot;')}" alt="" title="${safeLabel}" onerror="this.style.display='none'">`;
  }
  const letter = (String(label || '؟').trim().charAt(0) || '؟');
  return `<span class="poll-voter-img" style="background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;" title="${safeLabel}">${sanitizeText(letter)}</span>`;
}'''

new = '''function pollVoterAvatarHtml(key, label) {
  const photo = pollVoterPhoto(key);
  const safeLabel = sanitizeText(label || '').replace(/"/g, '&quot;');
  const letter = (String(label || '؟').trim().charAt(0) || '؟');
  const imgHtml = photo
    ? `<img class="poll-voter-img" src="${sanitizeText(photo).replace(/"/g, '&quot;')}" alt="" title="${safeLabel}" onerror="this.style.display='none'">`
    : `<span class="poll-voter-img" style="background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;" title="${safeLabel}">${sanitizeText(letter)}</span>`;
  return `<div class="poll-voter-item">${imgHtml}<div class="poll-voter-name">${safeLabel}</div></div>`;
}'''

if old in content:
    content = content.replace(old, new, 1)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print('Replaced pollVoterAvatarHtml successfully')
else:
    print('OLD TEXT NOT FOUND')
    idx = content.find('function pollVoterAvatarHtml')
    if idx >= 0:
        print(repr(content[idx:idx+800]))