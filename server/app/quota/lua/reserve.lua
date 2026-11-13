-- 原子预扣：检查 + 冻结在一个脚本内完成，杜绝并发超卖。
-- KEYS[1] 钱包 hash   {bal=可用余额, frz=冻结中, lver=加载版本}
-- KEYS[2] 套餐余量 hash {<pkg_id>=剩余 token}
-- KEYS[3] 令牌额度 hash {rem=剩余额度}（不限额令牌传任意不存在的 key 且 limited=0）
-- KEYS[4] 预扣单 hash
-- ARGV[1] JSON: {rid, pkgs:[{id, req}], cost, limited, ttl, ctx}
--   pkgs 已由调用方按到期时间升序过滤为适用当前模型的套餐；req 为该套餐计量规则下的预估 token
--   cost 为全部走钱包时的预估金额（微元）
-- 返回 JSON：{ok=1, alloc=[...], wallet=n} 或 {ok=0, err="..."}

local p = cjson.decode(ARGV[1])

if redis.call('EXISTS', KEYS[4]) == 1 then
  return cjson.encode({ok = 1, dup = 1, alloc = cjson.decode(redis.call('HGET', KEYS[4], 'alloc'))})
end
if redis.call('EXISTS', KEYS[1]) == 0 then
  return cjson.encode({ok = 0, err = 'not_loaded'})
end

local f = 1.0
local alloc = {}
for _, pk in ipairs(p.pkgs) do
  if f <= 1e-9 then break end
  local avail = tonumber(redis.call('HGET', KEYS[2], tostring(pk.id)) or '0')
  if avail > 0 and pk.req > 0 then
    local need = math.ceil(f * pk.req)
    local take = math.min(avail, need)
    if take >= need then f = 0 else f = f - take / pk.req end
    table.insert(alloc, {b = 'pkg', id = pk.id, r = take})
  end
end

local wneed = 0
if f > 1e-9 and p.cost > 0 then wneed = math.ceil(f * p.cost) end

if wneed > 0 then
  local bal = tonumber(redis.call('HGET', KEYS[1], 'bal') or '0')
  if bal < wneed then
    return cjson.encode({ok = 0, err = 'insufficient_balance', need = wneed, bal = bal})
  end
  if p.limited == 1 then
    local rem = tonumber(redis.call('HGET', KEYS[3], 'rem') or '0')
    if rem < wneed then
      return cjson.encode({ok = 0, err = 'token_quota_exceeded', need = wneed, rem = rem})
    end
  end
end

-- 校验全部通过后再落地变更
for _, a in ipairs(alloc) do
  redis.call('HINCRBY', KEYS[2], tostring(a.id), -a.r)
end
if wneed > 0 then
  redis.call('HINCRBY', KEYS[1], 'bal', -wneed)
  redis.call('HINCRBY', KEYS[1], 'frz', wneed)
  if p.limited == 1 then redis.call('HINCRBY', KEYS[3], 'rem', -wneed) end
  table.insert(alloc, {b = 'wallet', r = wneed})
end

local enc = cjson.encode(alloc)
-- ctx 保存结算所需上下文（预估用量、调用信息），供超时回收任务按预估值结算
redis.call('HSET', KEYS[4], 'alloc', enc, 'limited', p.limited, 'ctx', p.ctx or '{}')
redis.call('EXPIRE', KEYS[4], p.ttl)
return cjson.encode({ok = 1, alloc = alloc, wallet = wneed})
