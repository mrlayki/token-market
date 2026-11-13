-- 应用一次「外部变更」（充值、兑换、管理员调整、套餐发放/过期）到热数据。
-- 外部变更先在 PG 事务中提交并使 wallet.ext_version 自增，再调用本脚本：
--   * 热数据不存在：跳过（下次加载会从 PG 读到包含本次变更的快照）
--   * op 版本 <= 加载版本：PG 快照已包含，跳过（防止加载与变更竞争导致重复入账）
--   * 同一 op 重复投递：通过 applied 集合去重
-- KEYS[1] 钱包 hash  KEYS[2] 套餐余量 hash  KEYS[3] 套餐元数据 hash  KEYS[4] 已应用 op 集合
-- ARGV[1] JSON: {ver, op, bal_delta, pkg_set:[{id, rem, meta}], pkg_del:[id]}
if redis.call('EXISTS', KEYS[1]) == 0 then return 'skip_not_loaded' end
local p = cjson.decode(ARGV[1])
local lver = tonumber(redis.call('HGET', KEYS[1], 'lver') or '0')
if p.ver <= lver then return 'skip_snapshot' end
if redis.call('SADD', KEYS[4], p.op) == 0 then return 'skip_dup' end
redis.call('EXPIRE', KEYS[4], 604800)
if p.bal_delta and p.bal_delta ~= 0 then redis.call('HINCRBY', KEYS[1], 'bal', p.bal_delta) end
if type(p.pkg_set) == 'table' then
  for _, pk in ipairs(p.pkg_set) do
    redis.call('HSET', KEYS[2], tostring(pk.id), pk.rem)
    redis.call('HSET', KEYS[3], tostring(pk.id), pk.meta)
  end
end
if type(p.pkg_del) == 'table' then
  for _, id in ipairs(p.pkg_del) do
    redis.call('HDEL', KEYS[2], tostring(id))
    redis.call('HDEL', KEYS[3], tostring(id))
  end
end
return 'applied'
