export interface BaseAudioGenerationConfig {
}
export interface ITextToAudioStrategy<T extends BaseAudioGenerationConfig> {
    convertToAudio(input: string, config: T): Promise<Buffer>;
    convertToSpeechMarks(input: string, config: T): Promise<Buffer>;
}
