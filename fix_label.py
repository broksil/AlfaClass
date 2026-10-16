path = r'c:\Users\ALMUSTAFA\Desktop\مشاريع المواقع\AlfaClass-main\index.html'
with open(path, 'r', encoding='utf-8') as f:
    lines = f.readlines()
for i in range(10639, 10648):
    print(f'{i+1}: {repr(lines[i])}')