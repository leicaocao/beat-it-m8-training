(() => {
  const definitions = [
    { key: 'egg', label: '蛇卵与搬运', short: '蛇卵', color: '#f7b85f' },
    { key: 'fang', label: '攫取毒牙与连线', short: '毒牙', color: '#f78cc8' },
    { key: 'interrupt', label: '打断与关键读条', short: '打断', color: '#79c8ff' },
    { key: 'soak', label: '分摊与拦截', short: '分摊', color: '#bca0ff' },
    { key: 'wave', label: '腐蚀浪潮', short: '浪潮', color: '#72e6c3' },
    { key: 'phase', label: '阶段与易伤线索', short: '阶段', color: '#f5dc84' },
    { key: 'death', label: '死亡与复活', short: '死亡', color: '#ff8c8f' },
    { key: 'boss', label: '其他首领技能', short: '首领', color: '#9ab1d9' },
    { key: 'other', label: '其他事件', short: '其他', color: '#a4b2bc' },
  ];

  // IDs are from the guild's Nov 26 combat log and the Ula'tek BigWigs/DBM modules.
  const skills = [
    ['egg', [1290409, 1290990, 1295360, 1299650, 1300312, 1300751, 1301268, 1302950, 1304012, 1306862, 1307612, 1307617, 1307635, 1308275, 1312150, 1313754, 1315541], [
      '疫鳞卵簇', '疫鳞子嗣', '毒蛇呼唤', '剧毒之壳', '剧毒喷溅', '腐臭卵心', '腐臭薄膜', '厄鳞之卵', '厄鳞外壳', '蠕动孕育', '硬化',
      'Blightscale Clutch', 'Blightscale Spawn', 'Call of the Serpent', 'Noxious Shell', 'Noxious Splash', 'Rancid Yolk', 'Putrid Membrane', 'Doomscale Egg', 'Doomscale Shell', 'Malignant Shell', 'Writhing Gestation', 'Toxic Womb',
    ]],
    ['fang', [1301117, 1301118, 1311602, 1311609, 1311611], [
      '攫取毒牙', '凋萎静脉', '荒疫之脈', 'Grasping Fangs', 'Blight Vein',
    ]],
    ['interrupt', [1305650, 1305775], ['痛苦哀嚎', '恐怖咆哮', 'Anguished Cry', 'Dread Roar']],
    ['soak', [1287265, 1288879, 1293046, 1295905, 1299010, 1299757, 1299759, 1299919, 1300530, 1302842, 1306119, 1308927, 1310763, 1312262, 1312967, 1313529, 1316356], [
      '幽魂盘卷', '幽魂盤卷', '毒蛇之咬', '钙化尸骸', '易爆清除', '溃烂爆发', '剧毒灼烧', '剧毒孵化',
      'Spectral Coils', "Serpent's Bite", 'Calcified Corpse', 'Ingested Venom', 'Volatile Purge', 'Fester Burst', 'Toxic Incubation', 'Toxic Burn',
    ]],
    ['wave', [1292188, 1292211, 1292403, 1298570, 1311807, 1319282], ['腐蚀浪潮', '腐蝕浪潮', 'Caustic Waves']],
    ['phase', [1286860, 1292521, 1292566, 1292999, 1299526, 1300635, 1301512, 1307367], ['被缚之怒', '被縛之怒', '下潜', '烈毒之心', 'Rage of the Shackled', 'Submerge', 'Venomous Heart']],
    ['boss', [1286905, 1287036, 1290779, 1296301, 1297338, 1298367, 1298369, 1298417, 1298418, 1298559, 1299206, 1300685, 1300938, 1301007, 1301122, 1301213, 1301510, 1301800, 1302982, 1303347, 1303414, 1303620, 1304527, 1305163, 1305709, 1306858, 1310738, 1311037, 1313531, 1313757, 1313758, 1315342, 1315343], [
      '蛇母之怒', '岩石剧毒', '步履维艰', '无羁之怒', '恶臭痛击', '响尾猛击', '石化钉刺', '乌拉特克之羁绊', '盘绕猎物', '沸腾毒液', '酸液爆发', '酸液喷发', '剧毒母体', '灵魂绞杀者', '剧毒撕咬',
      "Mother's Wrath", 'Stone Venom', 'Hobbled', 'Unchecked Rage', 'Mephitic Thrash', 'Rattler Slam', 'Petrifying Sting', 'Circling Prey', 'Virulent Spit', 'Fury Unleashed', 'Gore Rattle', 'Malice', 'Shadow Molt', 'Toxic Womb', 'Boiling Venom', 'Acidic Burst', 'Acidic Expulsion', 'Soul Constrictor', 'Poisonous Bite',
    ]],
  ];

  const normalize = name => String(name ?? '').trim().replace(/’/g, "'").toLowerCase();
  const keysById = new Map();
  const keysByName = new Map();
  for (const [key, ids, names] of skills) {
    for (const id of ids) keysById.set(id, key);
    for (const name of names) keysByName.set(normalize(name), key);
  }

  function classify(event, bossSpellIds) {
    switch (normalize(event?.type)) {
      case 'death': case 'unit_died': case 'resurrect': case 'resurrection': case 'spell_resurrect':
        return 'death';
      case 'interrupt': case 'spell_interrupt':
        return 'interrupt';
      case 'phase': case 'phasechange': case 'phase_change':
        return 'phase';
    }
    const id = Number(event?.spellID);
    const key = keysById.get(id) ?? keysByName.get(normalize(event?.spell));
    if (key) return key;
    if (bossSpellIds?.has?.(id) || bossSpellIds?.includes?.(id)) return 'boss';
    return 'other';
  }

  globalThis.M8Mechanics = { definitions, classify };
})();
