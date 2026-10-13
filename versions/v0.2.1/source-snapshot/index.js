'use strict';

const path = require('path');
const { fs, log, util } = require('vortex-api');

let winapi;
try {
  winapi = require('winapi-bindings');
} catch (err) {
  winapi = undefined;
}

const GAME_ID = 'deadspace';
const GAME_NAME = 'Dead Space (2008)';
const STEAM_APP_ID = '17470';
const GAME_EXE = 'Dead Space.exe';
const ORIGINAL_REQUIRED_FILE = path.join(
  'loading_screen',
  'ch01_flt_loading_screen_global.toc',
);
const TEXMOD_DIRECTORY = 'TexMod Packages';
const MAX_ORIGINAL_EXE_SIZE = 64 * 1024 * 1024;

const REGISTRY_LOCATIONS = [
  ['HKEY_LOCAL_MACHINE', 'SOFTWARE\\WOW6432Node\\Electronic Arts\\EA Games\\Dead Space'],
  ['HKEY_LOCAL_MACHINE', 'SOFTWARE\\Electronic Arts\\EA Games\\Dead Space'],
  ['HKEY_LOCAL_MACHINE', 'SOFTWARE\\WOW6432Node\\Electronic Arts\\Dead Space'],
  ['HKEY_LOCAL_MACHINE', 'SOFTWARE\\Electronic Arts\\Dead Space'],
  ['HKEY_LOCAL_MACHINE', 'SOFTWARE\\WOW6432Node\\EA Games\\Dead Space'],
  ['HKEY_LOCAL_MACHINE', 'SOFTWARE\\EA Games\\Dead Space'],
  ['HKEY_LOCAL_MACHINE', 'SOFTWARE\\WOW6432Node\\Origin Games\\Dead Space'],
  ['HKEY_LOCAL_MACHINE', 'SOFTWARE\\Origin Games\\Dead Space'],
  ['HKEY_CURRENT_USER', 'SOFTWARE\\Electronic Arts\\EA Games\\Dead Space'],
  ['HKEY_CURRENT_USER', 'SOFTWARE\\Electronic Arts\\Dead Space'],
  ['HKEY_CURRENT_USER', 'SOFTWARE\\EA Games\\Dead Space'],
  ['HKEY_CURRENT_USER', 'SOFTWARE\\Origin Games\\Dead Space'],
  ['HKEY_LOCAL_MACHINE', 'SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{9789E33B-317A-44B2-AF9A-FF8708AD93E0}'],
  ['HKEY_LOCAL_MACHINE', 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{9789E33B-317A-44B2-AF9A-FF8708AD93E0}'],
];

const REGISTRY_VALUE_NAMES = [
  'Install Dir',
  'InstallDir',
  'Install Path',
  'InstallPath',
  'InstallLocation',
  'DisplayIcon',
  'Path',
  'GamePath',
];

const COMMON_INSTALL_PATHS = [
  'Dead Space',
  'EA Games/Dead Space',
  'Games/Dead Space',
  'Games/EA Games/Dead Space',
  'Origin Games/Dead Space',
  'Games/Origin Games/Dead Space',
  'Electronic Arts/Dead Space',
  'Games/Electronic Arts/Dead Space',
  'Program Files/EA Games/Dead Space',
  'Program Files (x86)/EA Games/Dead Space',
  'Program Files/Origin Games/Dead Space',
  'Program Files (x86)/Origin Games/Dead Space',
  'Program Files/Electronic Arts/Dead Space',
  'Program Files (x86)/Electronic Arts/Dead Space',
  'SteamLibrary/steamapps/common/Dead Space',
  'Steam/steamapps/common/Dead Space',
  'Games/Steam/steamapps/common/Dead Space',
  'Program Files/Steam/steamapps/common/Dead Space',
  'Program Files (x86)/Steam/steamapps/common/Dead Space',
];

const ROOT_MOD_EXTENSIONS = new Set([
  '.addon', '.asi', '.cfg', '.conf', '.dll', '.fx', '.fxh', '.ini',
  '.json', '.preset', '.toml', '.yaml', '.yml',
]);

const PRESERVED_ROOT_FOLDERS = new Set([
  'reshade-shaders',
  'reshade-presets',
  'scripts',
  'textures',
]);

const SYSTEM_ROOT_FOLDERS = new Set([
  '$recycle.bin',
  'boot',
  'documents and settings',
  'msocache',
  'perflogs',
  'program files',
  'program files (x86)',
  'programdata',
  'recovery',
  'system volume information',
  'users',
  'windows',
]);

function pathFromRelative(root, relativePath) {
  return path.join(root, ...relativePath.split('/'));
}

function uniquePaths(paths) {
  const seen = new Set();
  return paths.filter(candidate => {
    if (!candidate) {
      return false;
    }

    const key = path.normalize(candidate).toLowerCase();
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function unwrapRegistryValue(rawValue) {
  if (rawValue && typeof rawValue === 'object' && rawValue.value !== undefined) {
    return rawValue.value;
  }
  return rawValue;
}

function expandEnvironmentVariables(input) {
  const env = Object.keys(process.env).reduce((result, key) => {
    result[key.toLowerCase()] = process.env[key];
    return result;
  }, {});

  return input.replace(/%([^%]+)%/g, (match, variableName) =>
    env[variableName.toLowerCase()] || match);
}

function normalizeInstallPath(rawValue) {
  const unwrapped = unwrapRegistryValue(rawValue);
  if (typeof unwrapped !== 'string') {
    return undefined;
  }

  let candidate = expandEnvironmentVariables(unwrapped.replace(/\0/g, '').trim());
  if (candidate.startsWith('"')) {
    const closingQuote = candidate.indexOf('"', 1);
    candidate = closingQuote > 1 ? candidate.slice(1, closingQuote) : candidate.slice(1);
  } else {
    const executableIndex = candidate.toLowerCase().indexOf('.exe');
    if (executableIndex !== -1) {
      candidate = candidate.slice(0, executableIndex + 4);
    }
  }

  candidate = candidate.trim().replace(/[\\/]+$/, '');
  if (path.basename(candidate).toLowerCase() === GAME_EXE.toLowerCase()) {
    candidate = path.dirname(candidate);
  }

  return candidate || undefined;
}

async function statPath(candidate) {
  try {
    return await fs.statAsync(candidate);
  } catch (err) {
    return undefined;
  }
}

async function isFile(candidate) {
  const stats = await statPath(candidate);
  return stats !== undefined && stats.isFile();
}

async function isDirectory(candidate) {
  const stats = await statPath(candidate);
  return stats !== undefined && stats.isDirectory();
}

/**
 * The remake also uses "Dead Space.exe", so the executable name alone is not
 * sufficient. The original is small and has several legacy streamed-audio,
 * loading-screen, movie, and chapter-data directories. The remake's Data/Win32
 * layout is an explicit rejection marker. GL.ini is intentionally not required:
 * the current EA App build does not ship that Steam-specific file.
 */
async function isOriginalGamePath(rawCandidate) {
  const candidate = normalizeInstallPath(rawCandidate);
  if (!candidate) {
    return false;
  }

  const executableStats = await statPath(path.join(candidate, GAME_EXE));
  if (!executableStats || !executableStats.isFile()
      || executableStats.size > MAX_ORIGINAL_EXE_SIZE) {
    return false;
  }

  if (await isDirectory(path.join(candidate, 'Data', 'Win32'))) {
    return false;
  }

  const originalDataMarkers = await Promise.all([
    isDirectory(path.join(candidate, 'audiostreams')),
    isDirectory(path.join(candidate, 'loading_screen')),
    isDirectory(path.join(candidate, 'movies')),
    isDirectory(path.join(candidate, 'ch01_flt')),
    isDirectory(path.join(candidate, 'Core')),
  ]);

  return originalDataMarkers.filter(Boolean).length >= 2;
}

async function firstValidCandidate(candidates) {
  for (const rawCandidate of uniquePaths(candidates)) {
    const candidate = normalizeInstallPath(rawCandidate);
    if (await isOriginalGamePath(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

async function findViaGameStores() {
  try {
    const discovered = await util.GameStoreHelper.findByAppId([STEAM_APP_ID]);
    return firstValidCandidate([
      discovered && discovered.gamePath,
      discovered && discovered.path,
    ]);
  } catch (err) {
    log('debug', `${GAME_NAME}: Steam discovery did not return a valid install`, {
      error: err && err.message,
    });
    return undefined;
  }
}

function readRegistryCandidates() {
  if (!winapi || typeof winapi.RegGetValue !== 'function') {
    return [];
  }

  const candidates = [];
  REGISTRY_LOCATIONS.forEach(([hive, key]) => {
    REGISTRY_VALUE_NAMES.forEach(valueName => {
      try {
        const value = winapi.RegGetValue(hive, key, valueName);
        const candidate = normalizeInstallPath(value);
        if (candidate) {
          candidates.push(candidate);
        }
      } catch (err) {
        // Missing registry values are expected; continue to the next one.
      }
    });
  });

  return uniquePaths(candidates);
}

async function findViaRegistry() {
  return firstValidCandidate(readRegistryCandidates());
}

async function listMountedDriveRoots() {
  if (process.platform !== 'win32') {
    return [];
  }

  const roots = [];
  for (let code = 'A'.charCodeAt(0); code <= 'Z'.charCodeAt(0); code += 1) {
    const root = `${String.fromCharCode(code)}:\\`;
    if (await isDirectory(root)) {
      roots.push(root);
    }
  }

  return roots;
}

async function rootFolderCandidates(driveRoot) {
  let entries;
  try {
    entries = await fs.readdirAsync(driveRoot);
  } catch (err) {
    return [];
  }

  const searchableEntries = entries
    .filter(entry => typeof entry === 'string'
      && !SYSTEM_ROOT_FOLDERS.has(entry.toLowerCase()))
    .slice(0, 128);

  const candidates = [];
  searchableEntries.forEach(entry => {
    const base = path.join(driveRoot, entry);
    candidates.push(
      path.join(base, 'Dead Space'),
      path.join(base, 'EA Games', 'Dead Space'),
      path.join(base, 'Origin Games', 'Dead Space'),
      path.join(base, 'Electronic Arts', 'Dead Space'),
      path.join(base, 'Games', 'Dead Space'),
      path.join(base, 'steamapps', 'common', 'Dead Space'),
      path.join(base, 'SteamLibrary', 'steamapps', 'common', 'Dead Space'),
    );
  });

  return candidates;
}

async function findAcrossDrives() {
  const driveRoots = await listMountedDriveRoots();
  for (const driveRoot of driveRoots) {
    const commonCandidates = COMMON_INSTALL_PATHS
      .map(relativePath => pathFromRelative(driveRoot, relativePath));
    const boundedCandidates = await rootFolderCandidates(driveRoot);
    const result = await firstValidCandidate(commonCandidates.concat(boundedCandidates));
    if (result) {
      return result;
    }
  }

  return undefined;
}

async function findGame(api) {
  const methods = [
    ['Steam', findViaGameStores],
    ['EA/Origin registry', findViaRegistry],
    ['all mounted drives', findAcrossDrives],
  ];

  for (const [methodName, method] of methods) {
    const result = await method();
    if (result) {
      log('info', `${GAME_NAME}: found through ${methodName}`, { path: result });
      return result;
    }
  }

  if (api && typeof api.sendNotification === 'function') {
    api.sendNotification({
      id: 'deadspace-2008-discovery-failed',
      type: 'warning',
      message: 'Dead Space (2008) was not found automatically. In Games, set the folder manually to the directory containing Dead Space.exe and the original loading_screen, audiostreams, and movies folders. The 2023 remake is not supported by this extension.',
      allowSuppress: true,
    });
  }

  throw new Error('Dead Space (2008) was not found on Steam, in EA/Origin registry data, or in common game-library paths on mounted drives.');
}

function isDirectoryEntry(fileName) {
  return fileName.endsWith('/') || fileName.endsWith('\\');
}

function archiveSegments(fileName) {
  return fileName.replace(/\\/g, '/').split('/').filter(Boolean);
}

function testTexModContent(files, gameId) {
  const supported = gameId === GAME_ID
    && files.some(file => !isDirectoryEntry(file)
      && path.extname(file).toLowerCase() === '.tpf');
  return Promise.resolve({ supported, requiredFiles: [] });
}

function installTexModContent(api, files) {
  const instructions = files
    .filter(file => !isDirectoryEntry(file)
      && path.extname(file).toLowerCase() === '.tpf')
    .map(file => ({
      type: 'copy',
      source: file,
      destination: path.join(TEXMOD_DIRECTORY, path.basename(file)),
    }));

  if (api && typeof api.sendNotification === 'function') {
    api.sendNotification({
      id: 'deadspace-2008-texmod-runtime-required',
      type: 'warning',
      message: `TexMod packages are deployed to "${TEXMOD_DIRECTORY}". Vortex can manage these files, but it cannot perform TexMod's runtime texture injection. Launch the game through TexMod and select the required .tpf package there.`,
      allowSuppress: true,
    });
  }

  return Promise.resolve({ instructions });
}

function testRootModContent(files, gameId) {
  if (gameId !== GAME_ID || files.some(file =>
    path.extname(file).toLowerCase() === '.tpf')) {
    return Promise.resolve({ supported: false, requiredFiles: [] });
  }

  const supported = files.some(file => {
    if (isDirectoryEntry(file)) {
      return false;
    }

    const normalized = file.replace(/\\/g, '/').toLowerCase();
    return ROOT_MOD_EXTENSIONS.has(path.extname(file).toLowerCase())
      || normalized.includes('reshade-shaders/');
  });

  return Promise.resolve({ supported, requiredFiles: [] });
}

function wrapperToStrip(files) {
  const payload = files.filter(file => !isDirectoryEntry(file));
  if (payload.length === 0) {
    return undefined;
  }

  const segments = payload.map(archiveSegments);
  if (segments.some(parts => parts.length < 2)) {
    return undefined;
  }

  const first = segments[0][0];
  const common = segments.every(parts => parts[0].toLowerCase() === first.toLowerCase());
  if (!common || PRESERVED_ROOT_FOLDERS.has(first.toLowerCase())) {
    return undefined;
  }

  return first;
}

function installRootModContent(files) {
  const wrapper = wrapperToStrip(files);
  const instructions = files
    .filter(file => !isDirectoryEntry(file))
    .map(file => {
      const segments = archiveSegments(file);
      const destinationSegments = wrapper ? segments.slice(1) : segments;
      return {
        type: 'copy',
        source: file,
        destination: path.join(...destinationSegments),
      };
    });

  return Promise.resolve({ instructions });
}

async function setup(api, discovery) {
  if (!discovery || !await isOriginalGamePath(discovery.path)) {
    throw new Error('The selected folder is not a valid Dead Space (2008) installation. Select the folder containing Dead Space.exe and the original loading_screen, audiostreams, and movies folders.');
  }

  api.sendNotification({
    id: 'deadspace-2008-modding-help',
    type: 'info',
    message: `Vortex deploys DLL, INI, ASI, and ReShade files beside ${GAME_EXE}. TexMod .tpf files are kept in "${TEXMOD_DIRECTORY}" and still require TexMod to inject them when the game starts.`,
    allowSuppress: true,
    actions: [{
      title: 'Open game folder',
      action: () => util.opn(discovery.path).catch(() => undefined),
    }],
  });
}

function main(context) {
  context.registerGame({
    id: GAME_ID,
    name: GAME_NAME,
    mergeMods: true,
    logo: 'gameart.png',
    executable: () => GAME_EXE,
    requiredFiles: [GAME_EXE, ORIGINAL_REQUIRED_FILE],
    queryPath: () => findGame(context.api),
    queryModPath: () => '.',
    setup: discovery => setup(context.api, discovery),
    supportedTools: [],
    details: {
      steamAppId: Number(STEAM_APP_ID),
      nexusPageId: GAME_ID,
      hashFiles: [GAME_EXE, ORIGINAL_REQUIRED_FILE],
    },
  });

  context.registerInstaller(
    'deadspace-2008-texmod',
    15,
    testTexModContent,
    files => installTexModContent(context.api, files),
  );

  context.registerInstaller(
    'deadspace-2008-root-mod',
    25,
    testRootModContent,
    installRootModContent,
  );

  return true;
}

module.exports = {
  default: main,
  __test: {
    GAME_ID,
    GAME_EXE,
    TEXMOD_DIRECTORY,
    findGame,
    findViaRegistry,
    findAcrossDrives,
    isOriginalGamePath,
    normalizeInstallPath,
    testTexModContent,
    installTexModContent,
    testRootModContent,
    installRootModContent,
  },
};
