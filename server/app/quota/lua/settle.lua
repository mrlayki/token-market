-- 原子结算：按实际用量从冻结中扣减、多退少补，并在同一脚本内写入计量事件流，
-- 保证「Redis 额度变化」与「待落库事件」同时成功或同时失败。
-- KEYS[1] 钱包 hash  KEYS[2] 套餐余量 hash  KEYS[3] 令牌额度 hash  KEYS[4] 预扣单 hash
-- KEYS[5] 计量事件 stream
-- ARGV[1] JSON: {rid, pkgs:{<id>=实际 token}, cost, overdraft, event:{...}}
--   cost 为全部走钱包时的实际金额（微元）；overdraft 为允许透支额度（微元，>=0）
-- 返回 JSON：{ok=1, pkgs=[{id,used}], wallet=n, shortfall=n} / {ok=0, err='no_reservation'}

local p = cjson.decode(ARGV[1])
if redis.call('EXISTS', KEYS[4]) == 0 then
  return cjson.encode({ok = 0, err = 'no_reservation'})
end
local alloc = cjson.decode(redis.call('HGET', KEYS[4], 'alloc'))
local limited = tonumber(redis.call('HGET', KEYS[4], 'limited') or '0')

local f = 1.0
local used_pkgs = {}
local wreserved = 0
for _, a in ipairs(alloc) do
  if a.b == 'pkg' then
    local act = tonumber(p.pkgs[tostring(a.id)] or '0')
    local use = 0
    if f > 1e-9 and act > 0 then
      local need = math.ceil(f * act)
      if need <= a.r then
        use = need
      else
        local avail = tonumber(redis.call('HGET', KEYS[2], tostring(a.id)) or '0')
        local extra = math.min(math.max(avail, 0), need - a.r)
        use = a.r + extra
      end
      if use >= need then f = 0 else f = f - use / act end
    end
    -- 归还未使用的冻结 token（use > r 时为负数，即追加扣减）
    if a.r - use ~= 0 then redis.call('HINCRBY', KEYS[2], tostring(a.id), a.r - use) end
    table.insert(used_pkgs, {id = a.id, used = use})
  else
    wreserved = a.r
  end
end

local wneed = 0
if f > 1e-9 and p.cost > 0 then wneed = math.ceil(f * p.cost) end

local charged = wneed
local shortfall = 0
if wneed > wreserved then
  -- 超出预扣：从可用余额追加，允许透支到 -overdraft
  local bal = tonumber(redis.call('HGET', KEYS[1], 'bal') or '0')
  local can = bal + p.overdraft
  local extra = wneed - wreserved
  if extra > can then
    shortfall = extra - math.max(can, 0)
    charged = wreserved + math.max(can, 0)
  end
end

if wreserved > 0 then redis.call('HINCRBY', KEYS[1], 'frz', -wreserved) end
if wreserved - charged ~= 0 then redis.call('HINCRBY', KEYS[1], 'bal', wreserved - charged) end
if limited == 1 and wreserved - charged ~= 0 then
  redis.call('HINCRBY', KEYS[3], 'rem', wreserved - charged)
end
redis.call('DEL', KEYS[4])

local result = {ok = 1, pkgs = used_pkgs, wallet = charged, shortfall = shortfall}
if p.event and p.event ~= cjson.null then
  p.event.settle = result
  redis.call('XADD', KEYS[5], 'MAXLEN', '~', 1000000, '*', 'd', cjson.encode(p.event))
end
return cjson.encode(result)
