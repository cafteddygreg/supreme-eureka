def test_admin_forbidden(auth_client):
 assert auth_client.get('/api/admin/dashboard').status_code==403

def test_admin_dashboard(auth_client,user):
 user.is_admin=True
 # The shared SQLAlchemy session is committed by re-authentication.
 auth_client.post('/api/auth/google',json={'credential':'mock:test:Test'})
 assert auth_client.get('/api/admin/dashboard').status_code==200

def test_toggle_station(auth_client,user,station):
 user.is_admin=True
 auth_client.post('/api/auth/google',json={'credential':'mock:test:Test'})
 r=auth_client.post(f'/api/admin/stations/{station.id}/toggle')
 assert r.status_code==200
