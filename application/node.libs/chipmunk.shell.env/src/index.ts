import { exec } from 'child_process';

import * as os from 'os';

import { detectAvailableProfiles as getProfiles, ITerminalProfile } from './profiles';

export { getProfiles, ITerminalProfile };

const cache: any = {};

export function shell(command: string, ignoreCache: boolean = false, defShell?: string): Promise<string> {
    return new Promise((resolve, reject) => {
        if (cache[command] !== undefined && ignoreCache) {
            return resolve(cache[command]);
        }
        exec(command, { shell: defShell }, (error: Error | null, stdout: string, stderr: string) => {
            if (error instanceof Error) {
                return reject(error);
            }
            if (stderr.trim() !== '') {
                return reject(new Error(`Finished deu error: ${stderr}`));
            }
            if (typeof stdout !== 'string' || stdout.replace(/[\n\r]/gi, '').trim() === '') {
                stdout = '';
            }
            cache[command] = stdout;
            resolve(stdout);
        });
    });
}

export enum EPlatforms {
    aix = 'aix',
    darwin = 'darwin',
    freebsd = 'freebsd',
    linux = 'linux',
    openbsd = 'openbsd',
    sunos = 'sunos',
    win32 = 'win32',
    android = 'android',
}

export type TEnvVars = { [key: string]: string };

export function getEnvVars(ignoreCache: boolean = false): Promise<TEnvVars> {
    return new Promise((resolve, reject) => {
        if (os.platform() !== EPlatforms.darwin) {
            return resolve(Object.assign({}, process.env) as TEnvVars);
        }
        // GUI-Apps don't inherit all environment-variables on darwin
        shell('printenv', ignoreCache).then((stdout: string) => {
            const pairs: TEnvVars = {};
            stdout.split(/[\n\r]/gi).forEach((row: string) => {
                const pair: string[] = row.split('=');
                if (pair.length <= 1) {
                    return;
                }
                pairs[pair[0]] = row.replace(`${pair[0]}=`, '');
            });
            if (Object.keys(pairs).length === 0) {
                return resolve(Object.assign({}, process.env) as TEnvVars);
            }
            resolve(pairs);
        }).catch((error: Error) => {
            reject(error);
        });
    });
}

export function getEnvVar(name: string, ignoreCache: boolean = false): Promise<string> {
    return new Promise((resolve, reject) => {
        const possible: string | undefined = process.env[name];
        if (typeof possible === 'string' && possible.trim() !== '') {
            return resolve(possible);
        }
        getDefShell().then((defShell: string) => {
            let cmd: string = '';
            switch (os.platform()) {
                case EPlatforms.aix:
                case EPlatforms.android:
                case EPlatforms.darwin:
                case EPlatforms.freebsd:
                case EPlatforms.linux:
                case EPlatforms.openbsd:
                case EPlatforms.sunos:
                    cmd = `echo $${name}`;
                    break;
                case EPlatforms.win32:
                    cmd = `echo %${name}%`;
                    break;
            }
            let output: string = '';
            shell(cmd, ignoreCache, defShell).then((stdout: string) => {
                output = stdout.replace(/[\n\r]/gi, '').trim();
                if (os.platform() === EPlatforms.win32 && output === `%${name}%`) {
                    // Try unix way
                    cmd = `echo $${name}`;
                    shell(cmd, ignoreCache).then((stdoutUnixWay: string) => {
                        output = stdoutUnixWay.replace(/[\n\r]/gi, '').trim();
                        if (os.platform() === EPlatforms.win32 && output === `$${name}`) {
                            output = '';
                        }
                        resolve(output);
                    }).catch((error: Error) => {
                        reject(error);
                    });
                } else {
                    resolve(output);
                }
            }).catch((error: Error) => {
                reject(error);
            });
        }).catch((defShellErr: Error) => {
            reject(defShellErr);
        });
    });
}

export function getDefShell(ignoreCache: boolean = false): Promise<string> {
    return new Promise((resolve, reject) => {
        let shellPath: string | undefined;
        let command: string = '';
        switch (os.platform()) {
            case EPlatforms.aix:
            case EPlatforms.android:
            case EPlatforms.darwin:
            case EPlatforms.freebsd:
            case EPlatforms.linux:
            case EPlatforms.openbsd:
            case EPlatforms.sunos:
                shellPath = process.env.SHELL;
                command = 'echo $SHELL';
                break;
            case EPlatforms.win32:
                shellPath = process.env.COMSPEC;
                command = 'ECHO %COMSPEC%';
                break;
        }

        if (shellPath) {
            return resolve(shellPath);
        }

        // process didn't resolve shell, so we query it manually
        shell(command, ignoreCache).then((stdout: string) => {
            resolve(stdout.trim());
        }).catch((error: Error) => {
            // COMSPEC should always be available on windows.
            // Therefore: we will try to use /bin/sh as error-mitigation
            reject(error);
        });
    });
}

export function getShells(ignoreCache: boolean = false): Promise<string[]> {
    return new Promise((resolve, reject) => {
        getProfiles().then((profiles: ITerminalProfile[]) => {
            const shells: string[] = [];
            profiles.forEach((p) => {
                if (shells.indexOf(p.path) === -1) {
                    shells.push(p.path);
                }
            });
            resolve(shells);
        }).catch(reject);
    });
}
