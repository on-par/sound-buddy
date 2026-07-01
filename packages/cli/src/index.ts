#!/usr/bin/env node
import { Command } from 'commander'
import { runAnalyze } from './analyze.js'

const program = new Command()

program
  .name('buddy')
  .description('SoundCheck Buddy — M32R audio analysis CLI')
  .version('0.1.0')

program
  .command('diff <file1> <file2>')
  .description('Diff two M32R .scn scene files')
  .option('--json', 'Output as JSON')
  .action((_file1, _file2, _opts) => {
    console.error('buddy diff: not yet implemented')
    process.exit(1)
  })

program
  .command('analyze [file]')
  .description('Analyze audio file(s) with optional scene diff')
  .option('--dir <directory>', 'Analyze directory of per-channel files')
  .option('--scene <file>', 'Scene file for diff (pass twice for before/after)', (v, acc: string[]) => { acc.push(v); return acc }, [] as string[])
  .option('--json', 'Output as JSON')
  .option('--no-ai', 'Skip AI analysis')
  .action(async (file: string | undefined, opts: { scene: string[]; noAi: boolean }) => {
    try {
      const output = await runAnalyze({
        scenes: opts.scene ?? [],
        audio: file,
        noAi: opts.noAi ?? false,
      })
      process.stdout.write(output)
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })

program
  .command('record')
  .description('Real-time audio capture and analysis')
  .option('--device <name>', 'Audio input device')
  .option('--ch <channels>', 'Channel indices (e.g. 0,1,2)')
  .option('--window <secs>', 'Analysis window in seconds', '3')
  .action((_opts) => {
    console.error('buddy record: not yet implemented')
    process.exit(1)
  })

program.parse()
