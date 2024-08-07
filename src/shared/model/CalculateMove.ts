import { tags } from 'typia';

export type CalculateMoveAIMohex = {
    engine: 'mohex';

    /**
     * Limit Mohex power by limiting simulation games (param "max_games").
     */
    maxGames: number
        & tags.Minimum<1>
    ;
};

export type CalculateMoveAIKatahex = {
    engine: 'katahex';

    /**
     * Whether Katahex uses tree search (harder),
     * or only use raw neural network output (easier).
     */
    treeSearch: boolean;
};

export type CalculateMoveInput = {
    game: {
        size: number
            & tags.Minimum<1>
            & tags.Maximum<32>
        ;

        /**
         * All played move (i.e "a1 swap-pieces b2 pass ...").
         * Will calculate next move.
         */
        movesHistory: string;

        /**
         * Also guessed from moves count in history,
         * just checking.
         */
        currentPlayer: 'black' | 'white';

        swapRule: boolean;
    };

    ai: CalculateMoveAIMohex | CalculateMoveAIKatahex;
};

export type CalculateMoveOutput = string | 'resign';
