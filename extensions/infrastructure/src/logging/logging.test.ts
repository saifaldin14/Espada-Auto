/**
 * Infrastructure Logging Tests
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createInfrastructureLogger,
  compareLogLevels,
  shouldLog,
  createDefaultFormatter,
  ConsoleTransport,
  FileTransport,
  type InfrastructureLogLevel,
  type InfrastructureLogEntry,
  type LogTransport,
} from "./logger.js";

describe("Log Level Utilities", () => {
  describe("compareLogLevels", () => {
    it("should compare log levels correctly", () => {
      expect(compareLogLevels("trace", "debug")).toBe(-1);
      expect(compareLogLevels("debug", "debug")).toBe(0);
      expect(compareLogLevels("error", "info")).toBe(1);
    });

    it("should handle all level combinations", () => {
      const levels: InfrastructureLogLevel[] = ["trace", "debug", "info", "warn", "error", "fatal"];
      
      for (let i = 0; i < levels.length; i++) {
        for (let j = 0; j < levels.length; j++) {
          const result = compareLogLevels(levels[i], levels[j]);
          if (i < j) expect(result).toBe(-1);
          else if (i > j) expect(result).toBe(1);
          else expect(result).toBe(0);
        }
      }
    });
  });

  describe("shouldLog", () => {
    it("should determine if level should be logged", () => {
      expect(shouldLog("error", "info")).toBe(true);
      expect(shouldLog("debug", "info")).toBe(false);
      expect(shouldLog("info", "info")).toBe(true);
    });

    it("should handle trace level", () => {
      expect(shouldLog("trace", "trace")).toBe(true);
      expect(shouldLog("trace", "debug")).toBe(false);
    });

    it("should handle fatal level", () => {
      expect(shouldLog("fatal", "trace")).toBe(true);
      expect(shouldLog("fatal", "fatal")).toBe(true);
    });
  });
});

describe("Default Log Formatter", () => {
  it("should create formatter with default options", () => {
    const formatter = createDefaultFormatter();
    const entry: InfrastructureLogEntry = {
      timestamp: new Date("2024-01-01T00:00:00Z"),
      level: "info",
      subsystem: "test",
      message: "Test message",
    };
    
    const output = formatter(entry);
    expect(output).toContain("test");
    expect(output).toContain("Test message");
  });

  it("should format with colors when enabled", () => {
    const formatter = createDefaultFormatter({ colors: true });
    const entry: InfrastructureLogEntry = {
      timestamp: new Date(),
      level: "error",
      subsystem: "test",
      message: "Error message",
    };
    
    const output = formatter(entry);
    expect(output).toContain("ERROR");
  });

  it("should format without colors when disabled", () => {
    const formatter = createDefaultFormatter({ colors: false });
    const entry: InfrastructureLogEntry = {
      timestamp: new Date(),
      level: "info",
      subsystem: "test",
      message: "Plain message",
    };
    
    const output = formatter(entry);
    expect(output).toContain("INFO");
  });

  it("should include timestamps when enabled", () => {
    const formatter = createDefaultFormatter({ timestamps: true, colors: false });
    const entry: InfrastructureLogEntry = {
      timestamp: new Date("2024-01-15T10:30:00Z"),
      level: "info",
      subsystem: "test",
      message: "Timestamped",
    };
    
    const output = formatter(entry);
    expect(output).toContain("2024-01-15");
  });

  it("should exclude timestamps when disabled", () => {
    const formatter = createDefaultFormatter({ timestamps: false, colors: false });
    const entry: InfrastructureLogEntry = {
      timestamp: new Date("2024-01-15T10:30:00Z"),
      level: "info",
      subsystem: "test",
      message: "No timestamp",
    };
    
    const output = formatter(entry);
    expect(output).not.toContain("2024-01-15");
  });

  it("should include context information", () => {
    const formatter = createDefaultFormatter({ colors: false });
    const entry: InfrastructureLogEntry = {
      timestamp: new Date(),
      level: "info",
      subsystem: "test",
      message: "With context",
      providerId: "my-provider",
      sessionId: "session-123",
      duration: 150,
    };
    
    const output = formatter(entry);
    expect(output).toContain("provider=my-provider");
    expect(output).toContain("session=session-123");
    expect(output).toContain("duration=150ms");
  });

  it("should handle all log levels", () => {
    const formatter = createDefaultFormatter({ colors: false });
    const levels: InfrastructureLogLevel[] = ["trace", "debug", "info", "warn", "error", "fatal"];
    
    levels.forEach(level => {
      const entry: InfrastructureLogEntry = {
        timestamp: new Date(),
        level,
        subsystem: "test",
        message: `Message at ${level}`,
      };
      
      const output = formatter(entry);
      expect(output).toContain(level.toUpperCase());
    });
  });
});

describe("InfrastructureLogger", () => {
  describe("creation", () => {
    it("should create logger with subsystem name", () => {
      const logger = createInfrastructureLogger("test-subsystem");
      expect(logger.subsystem).toContain("test-subsystem");
    });

    it("should create logger with custom level", () => {
      const logger = createInfrastructureLogger("test", { level: "warn" });
      expect(logger.getLevel()).toBe("warn");
    });
  });

  describe("level management", () => {
    it("should report current level", () => {
      const logger = createInfrastructureLogger("test", { level: "warn" });
      expect(logger.getLevel()).toBe("warn");
    });

    it("should change level dynamically", () => {
      const logger = createInfrastructureLogger("test", { level: "info" });
      logger.setLevel("debug");
      expect(logger.getLevel()).toBe("debug");
    });

    it("should check if level is enabled", () => {
      const logger = createInfrastructureLogger("test", { level: "info" });
      
      expect(logger.isLevelEnabled("debug")).toBe(false);
      expect(logger.isLevelEnabled("info")).toBe(true);
      expect(logger.isLevelEnabled("error")).toBe(true);
    });
  });

  describe("child loggers", () => {
    it("should create child logger with extended subsystem", () => {
      const logger = createInfrastructureLogger("parent");
      const child = logger.child("child");
      
      // The actual format includes prefix "infrastructure/" and uses "/" separator
      expect(child.subsystem).toContain("parent");
      expect(child.subsystem).toContain("child");
    });

    it("should support nested children", () => {
      const logger = createInfrastructureLogger("root");
      const child1 = logger.child("level1");
      const child2 = child1.child("level2");
      
      expect(child2.subsystem).toContain("root");
      expect(child2.subsystem).toContain("level1");
      expect(child2.subsystem).toContain("level2");
    });
  });

  describe("context", () => {
    it("should create logger with context", () => {
      const logger = createInfrastructureLogger("test");
      const contextLogger = logger.withContext({
        providerId: "my-provider",
        sessionId: "session-123",
      });
      
      expect(contextLogger).toBeDefined();
      expect(contextLogger.subsystem).toContain("test");
    });
  });

  describe("logging methods", () => {
    it("should have all log methods", () => {
      const logger = createInfrastructureLogger("test");
      
      expect(typeof logger.trace).toBe("function");
      expect(typeof logger.debug).toBe("function");
      expect(typeof logger.info).toBe("function");
      expect(typeof logger.warn).toBe("function");
      expect(typeof logger.error).toBe("function");
      expect(typeof logger.fatal).toBe("function");
    });

    it("should log messages without errors", () => {
      const logger = createInfrastructureLogger("test", { level: "trace" });
      
      // These should not throw
      expect(() => logger.trace("trace message")).not.toThrow();
      expect(() => logger.debug("debug message")).not.toThrow();
      expect(() => logger.info("info message")).not.toThrow();
      expect(() => logger.warn("warn message")).not.toThrow();
      expect(() => logger.error("error message")).not.toThrow();
      expect(() => logger.fatal("fatal message")).not.toThrow();
    });

    it("should accept metadata", () => {
      const logger = createInfrastructureLogger("test", { level: "info" });
      
      expect(() => logger.info("message", { key: "value", count: 42 })).not.toThrow();
    });
  });
});

describe("Console Transport", () => {
  it("should create console transport", () => {
    const transport = new ConsoleTransport();
    
    expect(transport.name).toBe("console");
    expect(typeof transport.write).toBe("function");
  });

  it("should write entries", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const transport = new ConsoleTransport({ minLevel: "info" });
    
    transport.write({
      timestamp: new Date(),
      level: "info",
      subsystem: "test",
      message: "Console message",
    });
    
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("should filter by level", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const transport = new ConsoleTransport({ minLevel: "warn" });
    
    transport.write({
      timestamp: new Date(),
      level: "debug",
      subsystem: "test",
      message: "Should be filtered",
    });
    
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe("File Transport", () => {
  it("should create file transport", () => {
    const transport = new FileTransport({ filePath: "/tmp/test.log" });
    
    expect(transport.name).toBe("file");
    expect(typeof transport.write).toBe("function");
  });

  it("should accept buffer size option", () => {
    const transport = new FileTransport({
      filePath: "/tmp/test.log",
      bufferSize: 50,
    });
    
    expect(transport).toBeDefined();
  });

  it("should write without throwing", () => {
    const transport = new FileTransport({ filePath: "/tmp/test.log" });
    
    expect(() => {
      transport.write({
        timestamp: new Date(),
        level: "info",
        subsystem: "test",
        message: "File message",
      });
    }).not.toThrow();
  });
});

describe("Log Entry Structure", () => {
  it("should have required fields", () => {
    const entry: InfrastructureLogEntry = {
      timestamp: new Date(),
      level: "info",
      subsystem: "test",
      message: "Test message",
    };
    
    expect(entry.timestamp).toBeInstanceOf(Date);
    expect(entry.level).toBeDefined();
    expect(entry.subsystem).toBeDefined();
    expect(entry.message).toBeDefined();
  });

  it("should support optional fields", () => {
    const entry: InfrastructureLogEntry = {
      timestamp: new Date(),
      level: "error",
      subsystem: "test",
      message: "Full entry",
      metadata: { extra: "data" },
      providerId: "provider-1",
      sessionId: "session-1",
      commandId: "cmd-1",
      resourceId: "resource-1",
      duration: 100,
      error: {
        name: "Error",
        message: "Something went wrong",
        stack: "at test.js:1",
      },
    };
    
    expect(entry.metadata).toBeDefined();
    expect(entry.providerId).toBe("provider-1");
    expect(entry.duration).toBe(100);
    expect(entry.error?.name).toBe("Error");
  });
});
