export declare class CryptoUtil {
    private static textEncoder;
    static hashPassword(password: string): Promise<string>;
    static generateToken(): string;
}
