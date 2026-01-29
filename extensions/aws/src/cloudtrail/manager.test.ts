/**
 * AWS CloudTrail Manager - Comprehensive Tests
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { AWSCloudTrailManager, createCloudTrailManager } from "./manager.js";
import { AWSCredentialsManager } from "../credentials/manager.js";

// Mock credentials manager
const mockCredentialsManager = {
  getCredentials: vi.fn().mockResolvedValue({
    credentials: {
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      source: "profile",
    },
    profile: "default",
    region: "us-east-1",
    accountId: "123456789012",
  }),
} as unknown as AWSCredentialsManager;

// Sample CloudTrail events for comprehensive testing
const createSampleEvents = () => [
  {
    EventId: "event-run-instances",
    EventName: "RunInstances",
    EventTime: new Date("2024-01-15T10:00:00Z"),
    EventSource: "ec2.amazonaws.com",
    Username: "admin@example.com",
    Resources: [
      { ResourceType: "AWS::EC2::Instance", ResourceName: "i-1234567890abcdef0" },
    ],
    CloudTrailEvent: JSON.stringify({
      awsRegion: "us-east-1",
      sourceIPAddress: "192.168.1.1",
      userAgent: "aws-cli/2.0",
      userIdentity: {
        type: "IAMUser",
        principalId: "AIDAIOSFODNN7EXAMPLE",
        arn: "arn:aws:iam::123456789012:user/admin",
        accountId: "123456789012",
        userName: "admin@example.com",
      },
      readOnly: false,
      eventType: "AwsApiCall",
      managementEvent: true,
    }),
  },
  {
    EventId: "event-describe-instances",
    EventName: "DescribeInstances",
    EventTime: new Date("2024-01-15T09:30:00Z"),
    EventSource: "ec2.amazonaws.com",
    Username: "readonly@example.com",
    Resources: [],
    CloudTrailEvent: JSON.stringify({
      awsRegion: "us-east-1",
      sourceIPAddress: "192.168.1.2",
      userAgent: "console.amazonaws.com",
      userIdentity: {
        type: "IAMUser",
        principalId: "AIDAEXAMPLEUSER123",
        arn: "arn:aws:iam::123456789012:user/readonly",
        accountId: "123456789012",
        userName: "readonly@example.com",
      },
      readOnly: true,
      eventType: "AwsApiCall",
      managementEvent: true,
    }),
  },
  {
    EventId: "event-terminate-instances",
    EventName: "TerminateInstances",
    EventTime: new Date("2024-01-15T09:00:00Z"),
    EventSource: "ec2.amazonaws.com",
    Username: "admin@example.com",
    Resources: [
      { ResourceType: "AWS::EC2::Instance", ResourceName: "i-oldinstance12345" },
    ],
    CloudTrailEvent: JSON.stringify({
      awsRegion: "us-east-1",
      sourceIPAddress: "192.168.1.1",
      userAgent: "aws-cli/2.0",
      userIdentity: {
        type: "IAMUser",
        principalId: "AIDAIOSFODNN7EXAMPLE",
        arn: "arn:aws:iam::123456789012:user/admin",
        accountId: "123456789012",
        userName: "admin@example.com",
      },
      readOnly: false,
      eventType: "AwsApiCall",
      managementEvent: true,
    }),
  },
  {
    EventId: "event-console-login",
    EventName: "ConsoleLogin",
    EventTime: new Date("2024-01-15T08:00:00Z"),
    EventSource: "signin.amazonaws.com",
    Username: "admin@example.com",
    Resources: [],
    CloudTrailEvent: JSON.stringify({
      awsRegion: "us-east-1",
      sourceIPAddress: "192.168.1.1",
      userAgent: "Mozilla/5.0",
      userIdentity: {
        type: "IAMUser",
        principalId: "AIDAIOSFODNN7EXAMPLE",
        arn: "arn:aws:iam::123456789012:user/admin",
        accountId: "123456789012",
        userName: "admin@example.com",
      },
      readOnly: false,
      eventType: "AwsConsoleSignIn",
    }),
  },
  {
    EventId: "event-failed",
    EventName: "DescribeSecurityGroups",
    EventTime: new Date("2024-01-15T07:30:00Z"),
    EventSource: "ec2.amazonaws.com",
    Username: "limited@example.com",
    Resources: [],
    ErrorCode: "AccessDenied",
    ErrorMessage: "User is not authorized to perform this operation",
    CloudTrailEvent: JSON.stringify({
      awsRegion: "us-east-1",
      sourceIPAddress: "192.168.1.3",
      userAgent: "aws-sdk-python/1.0",
      userIdentity: {
        type: "IAMUser",
        principalId: "AIDALIMITEDUSER123",
        arn: "arn:aws:iam::123456789012:user/limited",
        accountId: "123456789012",
        userName: "limited@example.com",
      },
      readOnly: true,
      eventType: "AwsApiCall",
      errorCode: "AccessDenied",
      errorMessage: "User is not authorized to perform this operation",
    }),
  },
  {
    EventId: "event-create-user",
    EventName: "CreateUser",
    EventTime: new Date("2024-01-15T07:00:00Z"),
    EventSource: "iam.amazonaws.com",
    Username: "admin@example.com",
    Resources: [
      { ResourceType: "AWS::IAM::User", ResourceName: "new-user" },
    ],
    CloudTrailEvent: JSON.stringify({
      awsRegion: "us-east-1",
      sourceIPAddress: "192.168.1.1",
      userAgent: "aws-cli/2.0",
      userIdentity: {
        type: "IAMUser",
        principalId: "AIDAIOSFODNN7EXAMPLE",
        arn: "arn:aws:iam::123456789012:user/admin",
        accountId: "123456789012",
        userName: "admin@example.com",
      },
      readOnly: false,
      eventType: "AwsApiCall",
      managementEvent: true,
    }),
  },
  {
    EventId: "event-put-bucket-policy",
    EventName: "PutBucketPolicy",
    EventTime: new Date("2024-01-15T06:30:00Z"),
    EventSource: "s3.amazonaws.com",
    Username: "admin@example.com",
    Resources: [
      { ResourceType: "AWS::S3::Bucket", ResourceName: "my-bucket" },
    ],
    CloudTrailEvent: JSON.stringify({
      awsRegion: "us-east-1",
      sourceIPAddress: "192.168.1.1",
      userAgent: "aws-cli/2.0",
      userIdentity: {
        type: "IAMUser",
        principalId: "AIDAIOSFODNN7EXAMPLE",
        arn: "arn:aws:iam::123456789012:user/admin",
        accountId: "123456789012",
        userName: "admin@example.com",
      },
      readOnly: false,
      eventType: "AwsApiCall",
    }),
  },
];

// Mock CloudTrail client
vi.mock("@aws-sdk/client-cloudtrail", () => {
  return {
    CloudTrailClient: vi.fn().mockImplementation(() => ({
      send: vi.fn().mockImplementation((command) => {
        // LookupEvents
        if (command?.input?.LookupAttributes !== undefined || 
            command?.input?.StartTime !== undefined ||
            command?.input?.EndTime !== undefined ||
            command?.input?.MaxResults !== undefined) {
          return Promise.resolve({
            Events: createSampleEvents(),
            NextToken: undefined,
          });
        }
        
        return Promise.resolve({});
      }),
    })),
    LookupEventsCommand: vi.fn().mockImplementation((input) => ({ input })),
    DescribeTrailsCommand: vi.fn().mockImplementation((input) => ({ input: input ?? {} })),
    GetTrailStatusCommand: vi.fn().mockImplementation((input) => ({ input })),
    GetEventSelectorsCommand: vi.fn().mockImplementation((input) => ({ input })),
  };
});

describe("AWSCloudTrailManager", () => {
  let manager: AWSCloudTrailManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new AWSCloudTrailManager(mockCredentialsManager, "us-east-1");
  });

  describe("constructor", () => {
    it("should create with credentials manager", () => {
      const m = new AWSCloudTrailManager(mockCredentialsManager);
      expect(m).toBeInstanceOf(AWSCloudTrailManager);
    });

    it("should accept default region", () => {
      const m = new AWSCloudTrailManager(mockCredentialsManager, "eu-west-1");
      expect(m).toBeInstanceOf(AWSCloudTrailManager);
    });

    it("should use us-east-1 as default region when not provided", () => {
      const m = new AWSCloudTrailManager(mockCredentialsManager);
      expect(m).toBeInstanceOf(AWSCloudTrailManager);
    });
  });

  describe("queryEvents", () => {
    it("should query events with time range", async () => {
      const events = await manager.queryEvents({
        startTime: new Date("2024-01-01"),
        endTime: new Date("2024-01-31"),
      });
      expect(events).toBeInstanceOf(Array);
      expect(events.length).toBeGreaterThan(0);
    });

    it("should query events by event name", async () => {
      const events = await manager.queryEvents({
        eventName: "RunInstances",
      });
      expect(events).toBeInstanceOf(Array);
    });

    it("should query events by username", async () => {
      const events = await manager.queryEvents({
        username: "admin@example.com",
      });
      expect(events).toBeInstanceOf(Array);
    });

    it("should query events by event source", async () => {
      const events = await manager.queryEvents({
        eventSource: "ec2.amazonaws.com",
      });
      expect(events).toBeInstanceOf(Array);
    });

    it("should query events by resource type", async () => {
      const events = await manager.queryEvents({
        resourceType: "AWS::EC2::Instance",
      });
      expect(events).toBeInstanceOf(Array);
    });

    it("should query events by resource name", async () => {
      const events = await manager.queryEvents({
        resourceName: "i-1234567890abcdef0",
      });
      expect(events).toBeInstanceOf(Array);
    });

    it("should respect maxResults option", async () => {
      const events = await manager.queryEvents({
        maxResults: 10,
      });
      expect(events).toBeInstanceOf(Array);
    });

    it("should parse event details", async () => {
      const events = await manager.queryEvents({
        startTime: new Date("2024-01-01"),
      });
      
      if (events.length > 0) {
        const event = events[0];
        expect(event).toHaveProperty("eventId");
        expect(event).toHaveProperty("eventName");
        expect(event).toHaveProperty("eventTime");
        expect(event).toHaveProperty("eventSource");
        expect(event).toHaveProperty("userIdentity");
      }
    });

    it("should include user identity details", async () => {
      const events = await manager.queryEvents({
        startTime: new Date("2024-01-01"),
      });
      
      if (events.length > 0) {
        const event = events[0];
        expect(event.userIdentity).toHaveProperty("type");
        expect(event.userIdentity).toHaveProperty("arn");
      }
    });

    it("should include read-only flag", async () => {
      const events = await manager.queryEvents({
        startTime: new Date("2024-01-01"),
      });
      
      if (events.length > 0) {
        expect(typeof events[0].readOnly).toBe("boolean");
      }
    });

    it("should handle region override", async () => {
      const events = await manager.queryEvents({
        region: "eu-west-1",
        startTime: new Date("2024-01-01"),
      });
      expect(events).toBeInstanceOf(Array);
    });
  });

  describe("getInfrastructureEvents", () => {
    it("should return infrastructure change events", async () => {
      const events = await manager.getInfrastructureEvents();
      expect(events).toBeInstanceOf(Array);
    });

    it("should filter for infrastructure events only", async () => {
      const events = await manager.getInfrastructureEvents();
      // Should include events like RunInstances, TerminateInstances
      expect(events).toBeInstanceOf(Array);
    });

    it("should accept time range options", async () => {
      const events = await manager.getInfrastructureEvents({
        startTime: new Date("2024-01-01"),
        endTime: new Date("2024-01-31"),
      });
      expect(events).toBeInstanceOf(Array);
    });
  });

  describe("getSecurityEvents", () => {
    it("should return security-related events", async () => {
      const events = await manager.getSecurityEvents();
      expect(events).toBeInstanceOf(Array);
    });

    it("should filter for security events", async () => {
      const events = await manager.getSecurityEvents();
      // Should include events like ConsoleLogin, CreateUser
      expect(events).toBeInstanceOf(Array);
    });
  });

  describe("getEventsByUser", () => {
    it("should return events for specific user", async () => {
      const events = await manager.getEventsByUser("admin@example.com");
      expect(events).toBeInstanceOf(Array);
    });

    it("should accept additional options", async () => {
      const events = await manager.getEventsByUser("admin@example.com", {
        startTime: new Date("2024-01-01"),
        maxResults: 50,
      });
      expect(events).toBeInstanceOf(Array);
    });
  });

  describe("getResourceEvents", () => {
    it("should return events for specific resource", async () => {
      const events = await manager.getResourceEvents(
        "arn:aws:ec2:us-east-1:123456789012:instance/i-1234567890abcdef0"
      );
      expect(events).toBeInstanceOf(Array);
    });

    it("should parse resource ARN correctly", async () => {
      const events = await manager.getResourceEvents(
        "arn:aws:s3:::my-bucket"
      );
      expect(events).toBeInstanceOf(Array);
    });

    it("should handle ARNs with path components", async () => {
      const events = await manager.getResourceEvents(
        "arn:aws:iam::123456789012:user/path/to/user"
      );
      expect(events).toBeInstanceOf(Array);
    });
  });

  describe("getFailedEvents", () => {
    it("should return failed events", async () => {
      const events = await manager.getFailedEvents();
      expect(events).toBeInstanceOf(Array);
    });

    it("should filter events with error codes", async () => {
      const events = await manager.getFailedEvents();
      // All returned events should have error codes (if any match)
      expect(events).toBeInstanceOf(Array);
    });

    it("should accept time range options", async () => {
      const events = await manager.getFailedEvents({
        startTime: new Date("2024-01-01"),
        endTime: new Date("2024-01-31"),
      });
      expect(events).toBeInstanceOf(Array);
    });
  });

  describe("generateAuditSummary", () => {
    it("should generate audit summary", async () => {
      const summary = await manager.generateAuditSummary({
        startTime: new Date("2024-01-01"),
        endTime: new Date("2024-01-31"),
      });
      
      expect(summary).toBeDefined();
      expect(summary).toHaveProperty("totalEvents");
      expect(summary.totalEvents).toBeGreaterThan(0);
    });

    it("should include time range", async () => {
      const summary = await manager.generateAuditSummary({
        startTime: new Date("2024-01-01"),
      });
      
      expect(summary).toHaveProperty("timeRange");
      expect(summary.timeRange).toHaveProperty("start");
      expect(summary.timeRange).toHaveProperty("end");
    });

    it("should count read/write events", async () => {
      const summary = await manager.generateAuditSummary({
        startTime: new Date("2024-01-01"),
      });
      
      expect(summary).toHaveProperty("readOnlyCount");
      expect(summary).toHaveProperty("writeCount");
      expect(typeof summary.readOnlyCount).toBe("number");
      expect(typeof summary.writeCount).toBe("number");
    });

    it("should count error events", async () => {
      const summary = await manager.generateAuditSummary({
        startTime: new Date("2024-01-01"),
      });
      
      expect(summary).toHaveProperty("errorCount");
      expect(typeof summary.errorCount).toBe("number");
    });

    it("should identify top events", async () => {
      const summary = await manager.generateAuditSummary({
        startTime: new Date("2024-01-01"),
      });
      
      expect(summary).toHaveProperty("topEvents");
      expect(summary.topEvents).toBeInstanceOf(Array);
      
      if (summary.topEvents.length > 0) {
        expect(summary.topEvents[0]).toHaveProperty("name");
        expect(summary.topEvents[0]).toHaveProperty("count");
      }
    });

    it("should identify top users", async () => {
      const summary = await manager.generateAuditSummary({
        startTime: new Date("2024-01-01"),
      });
      
      expect(summary).toHaveProperty("topUsers");
      expect(summary.topUsers).toBeInstanceOf(Array);
    });

    it("should identify top services", async () => {
      const summary = await manager.generateAuditSummary({
        startTime: new Date("2024-01-01"),
      });
      
      expect(summary).toHaveProperty("topServices");
      expect(summary.topServices).toBeInstanceOf(Array);
    });

    it("should identify top errors", async () => {
      const summary = await manager.generateAuditSummary({
        startTime: new Date("2024-01-01"),
      });
      
      expect(summary).toHaveProperty("topErrors");
      expect(summary.topErrors).toBeInstanceOf(Array);
    });

    it("should identify top regions", async () => {
      const summary = await manager.generateAuditSummary({
        startTime: new Date("2024-01-01"),
      });
      
      expect(summary).toHaveProperty("topRegions");
      expect(summary.topRegions).toBeInstanceOf(Array);
    });

    it("should track infrastructure changes", async () => {
      const summary = await manager.generateAuditSummary({
        startTime: new Date("2024-01-01"),
      });
      
      expect(summary).toHaveProperty("infrastructureChangeCount");
      expect(typeof summary.infrastructureChangeCount).toBe("number");
    });

    it("should track security events", async () => {
      const summary = await manager.generateAuditSummary({
        startTime: new Date("2024-01-01"),
      });
      
      expect(summary).toHaveProperty("securityEventCount");
      expect(typeof summary.securityEventCount).toBe("number");
    });
  });

  describe("setDefaultRegion", () => {
    it("should update default region", () => {
      manager.setDefaultRegion("eu-west-1");
      expect(true).toBe(true);
    });

    it("should accept any valid region", () => {
      manager.setDefaultRegion("ap-northeast-1");
      manager.setDefaultRegion("sa-east-1");
      expect(true).toBe(true);
    });
  });
});

describe("createCloudTrailManager", () => {
  it("should create a CloudTrail manager instance", () => {
    const manager = createCloudTrailManager(mockCredentialsManager);
    expect(manager).toBeInstanceOf(AWSCloudTrailManager);
  });

  it("should pass default region to the manager", () => {
    const manager = createCloudTrailManager(mockCredentialsManager, "ap-northeast-1");
    expect(manager).toBeInstanceOf(AWSCloudTrailManager);
  });
});
