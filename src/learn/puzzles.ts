// Lethal puzzles, generated with the solver in puzzleEngine.ts: each has a winning line this turn that
// neither the Normal nor the Hard bot finds when playing your side. src/test/puzzles.test.ts checks every one.
import type { PuzzleDef } from './puzzleEngine';

const P = (d: Omit<PuzzleDef, 'text'>): PuzzleDef => ({ ...d, text: '' });

export const PUZZLES: PuzzleDef[] = [
  P({"id":"p1","title":"First Strike","me":{"hero":"NJJCGNjdCFzrjLqGfL6mR","hand":["Q9wHzF6BQjrjMwmKWBbpn","9zPDb7dgNqTgDTpGNDQHg","9HfD8KjKKWFc6CfCjKp9p","rLN8wNfkTtF9zBg8zwGzW","bnCP8zG8wBkghLtnppFqw"]},"opp":{"hero":"7FHM67fkfjCjzwWzKfFKH","life":7,"hand":[]}}),
  P({"id":"p2","title":"Spare Parts","me":{"hero":"6PPFnJ8tNtPKN6Km7NWpp","hand":["c9cWTPgkgQQJPQDFMJw7W","qfgqjM7QnmJKDnPkmgHTw","KGLtMJpW96RGNDCDf9P7T","JdRbp7cnCzB8PLFTQ8rLM"]},"opp":{"hero":"NGkHQHjzkFqfmGLKmRCpj","life":7,"hand":[]}}),
  P({"id":"p3","title":"Royal Decree","me":{"hero":"ncc6tmdrfHgnz9DhPqnwC","hand":["KTHGJMmtDhhmTdbm9zcQC","DbpqBt8Gp8HWg6QMFBBgh","RqL9CKpGPF6dMmDBhHDfT","z6Ltnt69ChWMCDBTTdWkL"]},"opp":{"hero":"npDPz98H6BnJGDzHBmdGk","life":8,"hand":[]}}),
  P({"id":"p4","title":"Storm Front","me":{"hero":"WwKdgRBmtM6CpRjwM97Lh","hand":["PHktCwKzLmBMwmCBwb7Cw","8zcbgBnjjdmM6G9hCqC9f","RN8gkCHTdn6DLWt7BzNfW","gDcLCrcfPQKNNpq8DkMFp"]},"opp":{"hero":"Dz6FcRBNMFdBt9fJPMB7d","life":9,"hand":[]}}),
  P({"id":"p5","title":"Gear Up","me":{"hero":"6PPFnJ8tNtPKN6Km7NWpp","hand":["Nfg6BhjddbLDCRHQgLzkf","rfDKkpDcHbmmMK9w6nmnt","QCNfk6P8BPNNwfP7WCczg","HGLJL8mtz7JNN9djNW68Q","gFQQLWKpNnLW9TPg86kL7"]},"opp":{"hero":"zdWrPkDgdbWdGBWjCLnhj","life":12,"hand":[]}}),
  P({"id":"p6","title":"Full Throttle","me":{"hero":"m8MzjMMWBw88jJj9gt9Qj","hand":["qfgqjM7QnmJKDnPkmgHTw","zTMPPB7wDcRLDLpQjRBdR","FgzGnMR8GKFpMNMr7DcKH","f7f6TfTFjkgtcbQJ9rhDC","wKJrpKpFH8hPhtRrgqKCn"]},"opp":{"hero":"PCcMjhHfKKrmH8hR9LQBc","life":12,"hand":[]}}),
  P({"id":"p7","title":"Through the Wall","me":{"hero":"Fc8mPQBjrNq6Fg9LW9RLc","hand":["BmMFHFgmDWmHn9H7QHBdF","nhf89Hr9rJkp9qDjDCCpt","rhGfKbpkJHqwTK6rJDcwK","6MRRLJw7g9wgwWPMDhzmT","RnbGbqBjNFp8HMNrzKWHp"]},"opp":{"hero":"d77Rnf7QF6pfMd6MNgGtm","life":9,"hand":["qgzjH8rNPpg6Jb6PgzggC","GH7npwLtcpTqqpKRzdnNg"]}}),
  P({"id":"p8","title":"Moonrise","me":{"hero":"Ht8qhJWDMHjjMjzqgf6KG","hand":["BCBhknzq8gBBhFFFFTGLc","DgQfj8jGQBWmBQKW9kngT","zQMMbcBbbRKKJcTwcCPPQ","CDLTkCC8RTrwFgLqPjWHc","QjLfPrBc8Rn76HhBcNbhj"],"arsenal":"rhGfKbpkJHqwTK6rJDcwK"},"opp":{"hero":"PCcMjhHfKKrmH8hR9LQBc","life":13,"hand":[]}}),
  P({"id":"p9","title":"Brute Force","me":{"hero":"zdWrPkDgdbWdGBWjCLnhj","hand":["KjgnpjTfDBhndccFCCDHn","KTHGJMmtDhhmTdbm9zcQC","FM6BwCnpcNT6TQCJmqWgf","CDLTkCC8RTrwFgLqPjWHc","c8GP9JNp9PKhcQg7TkBQR"],"arsenal":"6MRRLJw7g9wgwWPMDhzmT"},"opp":{"hero":"n9r77QwMzdWJmnfhPLN9J","life":11,"hand":["RJn7qQFgkNz6qR9rwntCc","qgzjH8rNPpg6Jb6PgzggC"]}}),
  P({"id":"p10","title":"Death by a Thousand Cuts","me":{"hero":"prMJkPd8w9KQHQ9BjgMmG","hand":["WqbqQqpFcbnChCQGT7mpm","PTbtpLNBrfMq9nNffBmMJ","qGLzQjzncCQztM6QrtwPn","cDBkbnjNDfkWKjqtWL7qq","gzdhT8FLprLrfPNCdNtR7"],"arsenal":"HGLJL8mtz7JNN9djNW68Q"},"opp":{"hero":"9HfDfRR8m8cLKDdg88gjm","life":13,"hand":[]}}),
  P({"id":"p11","title":"Arcane Arithmetic","me":{"hero":"bdD7LdLhpgdfLwzCq6jBc","hand":["wpjRKCTP7LDRPJ9JQRTWQ","tGd6nNtRQGbkcNjCRGB77","M8HJKTz7QwHTjGtjdHqDM","ntkQpCD8QdNG6KMNchJNw"],"arsenal":"RN8gkCHTdn6DLWt7BzNfW"},"opp":{"hero":"Dz6FcRBNMFdBt9fJPMB7d","life":7,"hand":["8p8KrLDmJnf6rMpTjQ6R6","FnPjLR9FPNJzBcJpCf8mQ"]}}),
];
