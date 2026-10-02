def test_pages(client,station):
 for url in ['/',f'/stations/{station.id}','/signaler','/notifications','/profil']:
  r=client.get(url);assert r.status_code==200
 assert 'Igitoro' in client.get('/').text
