p = r'c:\Users\ALMUSTAFA\Desktop\مشاريع المواقع\AlfaClass-main\index.html'
with open(p, 'r', encoding='utf-8') as f:
    content = f.read()

old = 'return `@${sanitizeText(k)}`;// يوزر (بيانات قديمة)'
new = 'return sanitizeText(k);// يوزر (بيانات قديمة) — بدون @'

if old in content:
    content = content.replace(old, new, 1)
    with open(p, 'w', encoding='utf-8') as f:
        f.write(content)
    print('Replaced pollVoterLabel username successfully')
else:
    print('OLD NOT FOUND in pollVoterLabel')
    idx = content.find('يوزر (بيانات قديمة)')
    print('Found at:', idx)
    print(repr(content[idx-60:idx+20]))