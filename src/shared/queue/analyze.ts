import { FlowProducer, Processor, Queue, QueueEvents, Worker } from 'bullmq';
import connection from '../connection';
import { WORKER_TASKS_QUEUE_NAME } from './workerTasks';
import { AnalyzeGameInput, AnalyzeGameOutput, AnalyzeMoveInput, AnalyzeMoveOutput, MoveAndValue, mirrorMoveAndValues } from '../model/AnalyzeGame';
import { WorkerInput } from '../model/WorkerTask';
import { ResultType } from '../model/ResultType';

export const ANALYZES_QUEUE_NAME = 'analyzes';

export const analyzesQueue = new Queue<AnalyzeGameInput, ResultType<AnalyzeGameOutput>>(ANALYZES_QUEUE_NAME, { connection });
export const analyzesQueueEvents = new QueueEvents(ANALYZES_QUEUE_NAME, { connection });
const analyzesFlow = new FlowProducer({ connection });

/**
 * Merge all move analyzes back to a single list.
 */
export const reconsolidateMoves: Processor<AnalyzeGameInput, ResultType<AnalyzeGameOutput>> = async (job) => {
    const analyzeMovesOutput = await job.getChildrenValues<ResultType<AnalyzeMoveOutput>>();
    const data: AnalyzeMoveOutput[] = Array(job.data.movesHistory.split(' ').length).fill(null);

    // Reorder all moves analyze to a single array
    for (const jobKey in analyzeMovesOutput) {
        const moveAnalyze = analyzeMovesOutput[jobKey];

        if (!moveAnalyze.success) {
            continue;
        }

        data[moveAnalyze.data.moveIndex] = moveAnalyze.data;
    }

    addSwapMoveAnalyze(data);

    // Set whiteWin from next position to previous move
    for (let i = 0; i < data.length; ++i) {
        const position = data[i];
        const nextPosition = data[i + 1];

        if (!position || !nextPosition) {
            continue;
        }

        position.move.whiteWin = nextPosition.whiteWin;

        // If move is in best moves list, also set whiteWin here
        for (let j = 0; j < position.bestMoves.length; ++j) {
            if (position.bestMoves[j].move === position.move.move) {
                position.bestMoves[j].whiteWin = nextPosition.whiteWin;
                break;
            }
        }
    }

    return {
        success: true,
        data,
    };
};

/**
 * In case of a swap move, second move will be empty.
 * Fill it with analyze from third move mirrored analyzis.
 */
export const addSwapMoveAnalyze = (data: AnalyzeMoveOutput[]): void => {
    if (null !== data[1] || undefined === data[2]) {
        return;
    }

    const swapMove: MoveAndValue = {
        move: 'swap-pieces',
        whiteWin: data[2].whiteWin,
        value: 0,
    };

    data[1] = {
        moveIndex: 1,
        color: 'white',
        whiteWin: 1 - data[2].whiteWin,
        move: swapMove,
        bestMoves: [
            swapMove,
            ...mirrorMoveAndValues(data[2].bestMoves).filter(m => undefined !== m.whiteWin),
        ].sort((a, b) => (b.whiteWin as number) - (a.whiteWin as number)),
    };
};

/**
 * From an AnalyzeGame, split all move to parallelize, and returns a list of worker tasks
 */
export const splitToWorkerTasks = (analyzeGameInput: AnalyzeGameInput): WorkerInput[] => {
    const analyzeMoveInputs: WorkerInput[] = [];
    const currentHistory: string[] = [];
    const moves = analyzeGameInput.movesHistory.split(' ');

    moves
        .forEach((move, moveIndex) => {
            analyzeMoveInputs.push({
                type: 'analyze-move',
                data: {
                    color: 0 === (moveIndex % 2) ? 'black' : 'white',
                    move,
                    moveIndex,
                    movesHistory: currentHistory.join(' '),
                    size: analyzeGameInput.size,
                    isLastMoveOfGame: moveIndex === moves.length - 1,
                },
            });

            currentHistory.push(move);
        })
    ;

    // Remove swap move analyze
    const secondMove = analyzeMoveInputs[1];

    if (secondMove && (secondMove.data as AnalyzeMoveInput).move === 'swap-pieces') {
        analyzeMoveInputs.splice(1, 1);
    }

    return analyzeMoveInputs;
};

export const addAnalyzeToQueue = async (analyzeGameInput: AnalyzeGameInput): Promise<ResultType<AnalyzeGameOutput>> => {
    const job = await analyzesFlow.add({
        name: 'analyze-game',
        queueName: ANALYZES_QUEUE_NAME,
        data: analyzeGameInput,
        children: splitToWorkerTasks(analyzeGameInput).map(workerInput => ({
            name: 'analyze-move',
            queueName: WORKER_TASKS_QUEUE_NAME,
            data: workerInput,
            opts: {
                priority: 20,
            },
        })),
    });

    return await job.job.waitUntilFinished(analyzesQueueEvents);
}

export const createAnalyzeWorker = () => new Worker<AnalyzeGameInput, ResultType<AnalyzeGameOutput>>(
    ANALYZES_QUEUE_NAME,
    reconsolidateMoves,
    {
        connection,
        concurrency: 1,
    },
);
