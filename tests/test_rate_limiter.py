from app.services.rate_limiter import DynamicRateLimiter
def test_limit():
 x=DynamicRateLimiter(2,60);assert x.allow('a');assert x.allow('a');assert not x.allow('a')
def test_risk():
 x=DynamicRateLimiter(3,60);assert x.allow('a',2);assert not x.allow('a',2)
