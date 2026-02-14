import Foundation

struct Item: Codable, Identifiable, Hashable {
    let id: String?
    let userId: String?
    let type: ItemType
    let title: String
    let date: String?
    let time: String?
    let endTime: String?
    let location: String?
    let description: String?
    let urgency: Urgency
    let category: Category
    let sourceHash: String?
    let rawText: String?
    let people: [String]?
    let sourceHashes: [String]?
    let occurrenceCount: Int?
    let dismissed: Bool?
    let lastSeenAt: String?
    let createdAt: String?

    enum ItemType: String, Codable, CaseIterable {
        case event, deadline, action, info
    }

    enum Urgency: String, Codable, CaseIterable {
        case high, medium, low
    }

    enum Category: String, Codable, CaseIterable {
        case sports, school, work, social, health, finance, family, other
    }

    enum CodingKeys: String, CodingKey {
        case id
        case userId = "user_id"
        case type, title, date, time
        case endTime = "end_time"
        case location, description, urgency, category
        case sourceHash = "source_hash"
        case sourceHashes = "source_hashes"
        case occurrenceCount = "occurrence_count"
        case rawText = "raw_text"
        case people, dismissed
        case lastSeenAt = "last_seen_at"
        case createdAt = "created_at"
    }

    // Stable identity for SwiftUI
    var stableId: String {
        id ?? UUID().uuidString
    }
}

// For OpenRouter extraction (different key naming)
struct ExtractedItem: Codable {
    let type: String
    let title: String
    let date: String?
    let time: String?
    let endTime: String?
    let location: String?
    let description: String?
    let urgency: String
    let category: String
    let people: [String]?
    let rawText: String?

    func toItem(sourceHash: String) -> Item {
        Item(
            id: nil,
            userId: nil,
            type: Item.ItemType(rawValue: type) ?? .info,
            title: title,
            date: date,
            time: time,
            endTime: endTime,
            location: location,
            description: description,
            urgency: Item.Urgency(rawValue: urgency) ?? .medium,
            category: Item.Category(rawValue: category) ?? .other,
            sourceHash: sourceHash,
            rawText: rawText,
            people: people,
            sourceHashes: sourceHash.isEmpty ? [] : [sourceHash],
            occurrenceCount: 1,
            dismissed: false,
            lastSeenAt: nil,
            createdAt: nil
        )
    }
}

struct DashboardAlert: Codable, Hashable {
    let text: String
    let urgency: String
}

struct DashboardSection: Codable, Hashable {
    let title: String
    let items: [Item]
}

struct DashboardResponse: Codable {
    let summary: String
    let alerts: [DashboardAlert]
    let sections: [DashboardSection]
    let itemCount: Int?
    let updatedAt: String?
}

extension Item.ItemType {
    var label: String {
        switch self {
        case .event: "Event"
        case .deadline: "Due"
        case .action: "To-Do"
        case .info: "FYI"
        }
    }
}

extension Item.Urgency {
    var sortOrder: Int {
        switch self {
        case .high: 0
        case .medium: 1
        case .low: 2
        }
    }
}

extension Item.Category {
    var icon: String {
        switch self {
        case .sports: "figure.run"
        case .school: "book.fill"
        case .work: "briefcase.fill"
        case .social: "party.popper.fill"
        case .health: "heart.fill"
        case .finance: "dollarsign.circle.fill"
        case .family: "figure.2.and.child"
        case .other: "pin.fill"
        }
    }
}
