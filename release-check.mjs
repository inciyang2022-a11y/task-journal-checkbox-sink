import { existsSync, readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const versions = JSON.parse(readFileSync('versions.json', 'utf8'));
const requiredFiles = ['README.md', 'LICENSE', 'CHANGELOG.md', 'PUBLISHING.md'];
const errors = [];

if (manifest.version !== packageJson.version) {
	errors.push(`manifest version ${manifest.version} does not match package version ${packageJson.version}`);
}

if (versions[manifest.version] !== manifest.minAppVersion) {
	errors.push(`versions.json does not map ${manifest.version} to ${manifest.minAppVersion}`);
}

if (manifest.id !== 'task-journal-checkbox-sink') {
	errors.push('plugin id changed unexpectedly');
}

if (!manifest.author || !manifest.description || !manifest.name) {
	errors.push('manifest author, description, and name are required');
}

for (const file of requiredFiles) {
	if (!existsSync(file)) {
		errors.push(`missing required release file: ${file}`);
	}
}

const releaseTag = process.env.RELEASE_TAG;
if (releaseTag && releaseTag !== manifest.version) {
	errors.push(`release tag ${releaseTag} does not match manifest version ${manifest.version}`);
}

if (errors.length > 0) {
	console.error(errors.map((error) => `- ${error}`).join('\n'));
	process.exit(1);
}

console.log(`Release metadata is consistent for ${manifest.version}.`);
