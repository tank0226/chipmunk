import ServiceElectron, { IPCMessages as IPCElectronMessages, Subscription } from '../../services/service.electron';
import Logger from '../../tools/env.logger';
import * as fs from 'fs';
import ControllerStreamFileReader from '../stream.main/file.reader';
import State from './state';
import { EventsHub } from '../stream.common/events';
import { ChartingEngine, TChartData, IMatch, IChartRequest } from './engine/controller';
import * as Tools from '../../tools/index';

export interface IRange {
    from: number;
    to: number;
}

export interface IRangeMapItem {
    rows: IRange;
    bytes: IRange;
}

const CSettings = {
    delayOnAppend: 250, // ms, Delay for sending notifications about stream's update to render (client) via IPC, when stream is blocked
};

export default class ControllerStreamCharts {

    private _logger: Logger;
    private _reader: ControllerStreamFileReader;
    private _subscriptions: { [key: string ]: Subscription | undefined } = { };
    private _state: State;
    private _charting: ChartingEngine;
    private _events: EventsHub;

    constructor(guid: string, streamFile: string, searchFile: string, streamState: EventsHub) {
        this._events = streamState;
        // Create controllers
        this._state = new State(guid, streamFile, searchFile);
        this._logger = new Logger(`ControllerStreamSearch: ${this._state.getGuid()}`);
        this._charting = new ChartingEngine(this._state);
        this._reader = new ControllerStreamFileReader(this._state.getGuid(), this._state.getStreamFile());
        // Listen IPC messages
        ServiceElectron.IPC.subscribe(IPCElectronMessages.ChartRequest, this._ipc_onChartRequest.bind(this)).then((subscription: Subscription) => {
            this._subscriptions.ChartRequest = subscription;
        }).catch((error: Error) => {
            this._logger.warn(`Fail to subscribe to render event "ChartRequest" due error: ${error.message}. This is not blocked error, loading will be continued.`);
        });
        ServiceElectron.IPC.subscribe(IPCElectronMessages.ChartRequestCancelRequest, this._ipc_onChartRequestCancelRequest.bind(this)).then((subscription: Subscription) => {
            this._subscriptions.ChartRequestCancelRequest = subscription;
        }).catch((error: Error) => {
            this._logger.warn(`Fail to subscribe to render event "ChartRequestCancelRequest" due error: ${error.message}. This is not blocked error, loading will be continued.`);
        });
    }

    public destroy(): Promise<void> {
        return new Promise((resolve, reject) => {
            // Unsubscribe IPC messages / events
            Object.keys(this._subscriptions).forEach((key: string) => {
                (this._subscriptions as any)[key].destroy();
            });
            // Clear results file
            this._clear().catch((error: Error) => {
                this._logger.error(`Error while killing: ${error.message}`);
            }).finally(() => {
                // Kill executor
                this._charting.destroy();
                // Kill reader
                this._reader.destroy();
                // Done
                resolve();
            });
        });
    }

    private _extract(requests: IChartRequest[], requestId: string): Promise<TChartData> {
        return new Promise((resolve, reject) => {
            // Start inspecting
            const inspecting = this._charting.extract(requests);
            if (inspecting instanceof Error) {
                this._logger.warn(`Fail to start extract chart data due error: ${inspecting.message}`);
                return;
            }
            inspecting.then((data: TChartData) => {
                resolve(data);
            }).catch((execErr: Error) => {
                reject(execErr);
                this._logger.warn(`Fail to make extract chart data due error: ${execErr.message}`);
            });
        });

    }

    private _clear(): Promise<void> {
        return new Promise((resolve, reject) => {
            // Cancel current task if exist
            this._charting.cancel();
            resolve();
        });
    }

    private _ipc_onChartRequest(message: IPCElectronMessages.TMessage, response: (instance: any) => any) {
        const request: IPCElectronMessages.ChartRequest = message as IPCElectronMessages.ChartRequest;
        // Store starting tile
        const started: number = Date.now();
        // Check target stream
        if (this._state.getGuid() !== request.streamId) {
            return;
        }
        // Check count of requests
        if (request.requests.length === 0) {
            return this._ipc_chartResultsResponse(response, {
                id: request.requestId,
                started: started,
                results: {},
            });
        }
        // Clear results file
        this._clear().then(() => {
            // Create regexps
            const requests: IChartRequest[] = request.requests.map((regInfo: IPCElectronMessages.IChartRegExpStr) => {
                return {
                    regExp: new RegExp(regInfo.source, regInfo.flags),
                    groups: regInfo.groups,
                };
            });
            this._extract(requests, request.requestId).then((data: TChartData) => {
                // Responce with results
                this._ipc_chartResultsResponse(response, {
                    id: request.requestId,
                    started: started,
                    results: data,
                });
            }).catch((searchErr: Error) => {
                return this._ipc_chartResultsResponse(response, {
                    id: request.requestId,
                    started: started,
                    error: searchErr.message,
                });
            });
        }).catch((droppingErr: Error) => {
            this._logger.error(`Fail drop search file due error: ${droppingErr.message}`);
            return this._ipc_chartResultsResponse(response, {
                id: request.requestId,
                started: started,
                error: droppingErr.message,
            });
        });
    }

    private _ipc_chartResultsResponse(response: (instance: any) => any, res: {
        id: string, started: number, error?: string, results?: TChartData,
    }) {
        response(new IPCElectronMessages.ChartRequestResults({
            streamId: this._state.getGuid(),
            requestId: res.id,
            error: res.error,
            results: res.results === undefined ? {} : res.results,
            duration: Date.now() - res.started,
        }));
    }

    private _ipc_onChartRequestCancelRequest(message: IPCElectronMessages.TMessage, response: (instance: any) => any) {
        const request: IPCElectronMessages.ChartRequestCancelRequest = message as IPCElectronMessages.ChartRequestCancelRequest;
        // Clear results file
        this._clear().then(() => {
            response(new IPCElectronMessages.ChartRequestCancelResponse({
                streamId: this._state.getGuid(),
                requestId: request.requestId,
            }));
        }).catch((error: Error) => {
            response(new IPCElectronMessages.ChartRequestCancelResponse({
                streamId: this._state.getGuid(),
                requestId: request.requestId,
                error: error.message,
            }));
        });
    }

}