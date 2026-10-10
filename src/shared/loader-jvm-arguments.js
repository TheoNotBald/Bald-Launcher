'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const osNames = {
  win32: 'windows',
  darwin: 'osx',
  linux: 'linux',
};

const architectures = {
  x64: 'x86_64',
  ia32: 'x86',
  arm64: 'aarch64',
};

function ruleMatches(rule, platform, architecture, osVersion, features) {
  if (!rule || typeof rule !== 'object') return false;
  if (rule.os?.name && rule.os.name !== platform) return false;
  if (rule.os?.arch && rule.os.arch !== architecture) return false;
  if (rule.os?.version && !new RegExp(rule.os.version).test(osVersion)) return false;
  if (rule.features && Object.entries(rule.features).some(([name, enabled]) => Boolean(features[name]) !== enabled)) return false;
  return true;
}

function getLoaderJvmArguments(versionJsonPath, options = {}) {
  const version = JSON.parse(fs.readFileSync(versionJsonPath, 'utf8'));
  const argumentsList = version?.arguments?.jvm;
  if (!Array.isArray(argumentsList)) return [];

  const platform = osNames[options.platform || process.platform] || options.platform || process.platform;
  const architecture = architectures[options.architecture || process.arch] || options.architecture || process.arch;
  const osVersion = options.osVersion || os.release();
  const features = options.features || {};
  const placeholders = {
    library_directory: path.resolve(options.libraryDirectory || path.join(path.dirname(versionJsonPath), '..', '..', 'libraries')),
    classpath_separator: options.classpathSeparator || path.delimiter,
    version_name: options.versionName || version.id || '',
    natives_directory: path.resolve(options.nativesDirectory || path.join(path.dirname(versionJsonPath), '..', '..', 'natives')),
  };

  return argumentsList.flatMap(argument => {
    let values;
    if (typeof argument === 'string') {
      values = [argument];
    } else if (argument && typeof argument === 'object' && !Array.isArray(argument) && Object.hasOwn(argument, 'value')) {
      if (Array.isArray(argument.rules)) {
        let allowed = false;
        for (const rule of argument.rules) {
          if (ruleMatches(rule, platform, architecture, osVersion, features)) allowed = rule.action === 'allow';
        }
        if (!allowed) return [];
      }
      values = Array.isArray(argument.value) ? argument.value : [argument.value];
    } else {
      throw new TypeError(`Unsupported JVM argument in ${versionJsonPath}`);
    }

    return values.map(value => {
      if (typeof value !== 'string') throw new TypeError(`Invalid JVM argument in ${versionJsonPath}`);
      return value.replace(/\$\{([^}]+)\}/g, (placeholder, name) => Object.hasOwn(placeholders, name) ? placeholders[name] : placeholder);
    });
  });
}

module.exports = { getLoaderJvmArguments };
