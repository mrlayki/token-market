-- 从 PG 快照初始化用户额度热数据（仅在不存在时）。
-- KEYS[1] 钱包 hash  KEYS[2] 套餐余量 hash  KEYS[3] 套餐元数据 hash
-- ARGV[1] JSON: {bal, ver, pkgs:[{id, rem, meta}]}
-- 返回 1 = 已初始化，0 = 已存在（被并发加载抢先）
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
local p = cjson.decode(ARGV[1])
redis.call('HSET', KEYS[1], 'bal', p.bal, 'frz', 0, 'lver', p.ver)
redis.call('DEL', KEYS[2], KEYS[3])
for _, pk in ipairs(p.pkgs) do
  redis.call('HSET', KEYS[2], tostring(pk.id), pk.rem)
  redis.call('HSET', KEYS[3], tostring(pk.id), pk.meta)
end
return 1
