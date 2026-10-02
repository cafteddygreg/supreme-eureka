def test_subscribe(auth_client):assert auth_client.post('/api/notifications/subscribe',json={'zone':'Kinindo'}).status_code==200
def test_unsubscribe(auth_client):auth_client.post('/api/notifications/subscribe',json={'zone':'Kinindo'});assert auth_client.post('/api/notifications/unsubscribe',json={'zone':'Kinindo'}).status_code==200
def test_notifications(auth_client):assert auth_client.get('/api/notifications').status_code==200
