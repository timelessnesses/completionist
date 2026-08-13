class Importer {
    constructor() {
        throw new Error("Cannot instantiate abstract class Importer directly.");
    }

    async fetchData(): Promise<any> { 
        throw new Error("Method 'fetchData' must be implemented in subclasses.");
    }
}