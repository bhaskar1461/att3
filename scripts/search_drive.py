import pickle
import requests

with open('backend/token.pickle', 'rb') as f:
    creds = pickle.load(f)

params = {
    'q': "name contains 'CSE' or name contains 'Sowjanya' or name contains 'Attendance'",
    'fields': 'files(id,name,mimeType,owners,shared)'
}
r = requests.get('https://www.googleapis.com/drive/v3/files', headers={'Authorization': f'Bearer {creds.token}'}, params=params)
for f in r.json().get('files', []):
    print(f['name'], '-> ID:', f['id'], '-> mime:', f['mimeType'], '-> owners:', [o.get('emailAddress') for o in f.get('owners', [])])
