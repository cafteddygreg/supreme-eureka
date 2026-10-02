from collections import defaultdict,deque
from time import monotonic
class DynamicRateLimiter:
    def __init__(self,base_limit=5,window=3600): self.base_limit=base_limit; self.window=window; self.events=defaultdict(deque)
    def allow(self,key,risk=0):
        t=monotonic(); q=self.events[key]
        while q and t-q[0]>self.window:q.popleft()
        limit=max(1,self.base_limit-risk)
        if len(q)>=limit:return False
        q.append(t);return True
limiter=DynamicRateLimiter()
