import SwiftUI

struct CardView: View {
    let item: Item
    var onDismiss: (() -> Void)?
    var onTap: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Top row: category + type badge
            HStack {
                Label(item.category.rawValue.capitalized, systemImage: item.category.icon)
                    .font(.caption2)
                    .foregroundStyle(.secondary)

                Spacer()

                Text(item.type.label)
                    .font(.caption2.weight(.semibold))
                    .textCase(.uppercase)
                    .tracking(0.3)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(typeBadgeColor.opacity(0.15))
                    .foregroundStyle(typeBadgeColor)
                    .clipShape(RoundedRectangle(cornerRadius: 5))
            }

            // Title
            Text(item.title)
                .font(.subheadline.weight(.semibold))
                .lineLimit(2)

            // Date/time subtitle
            if let subtitle = formattedDateTime {
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            // Location
            if let location = item.location {
                Label(location, systemImage: "mappin")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            // Description
            if let desc = item.description, !desc.isEmpty {
                Text(desc)
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .lineLimit(3)
            }

            // Urgency badge for high items
            if item.urgency == .high {
                Text("Needs attention")
                    .font(.caption2.weight(.bold))
                    .textCase(.uppercase)
                    .foregroundStyle(.red)
            }

            if hasSourceReferences {
                Label("Tap to view source screenshot", systemImage: "photo")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .strokeBorder(urgencyBorderColor, lineWidth: urgencyBorderWidth)
        )
        .swipeActions(edge: .trailing) {
            if let onDismiss = onDismiss {
                Button(role: .destructive) {
                    onDismiss()
                } label: {
                    Label("Dismiss", systemImage: "xmark")
                }
            }
        }
        .contextMenu {
            if let onTap = onTap {
                Button {
                    onTap()
                } label: {
                    Label("View Source", systemImage: "photo")
                }
            }
            if let onDismiss = onDismiss {
                Button(role: .destructive) {
                    onDismiss()
                } label: {
                    Label("Dismiss", systemImage: "xmark.circle")
                }
            }
        }
        .onTapGesture {
            onTap?()
        }
    }

    // MARK: - Computed

    private var formattedDateTime: String? {
        var parts: [String] = []
        if let date = item.date { parts.append(date) }
        if let time = item.time {
            parts.append(time)
            if let endTime = item.endTime {
                parts[parts.count - 1] = "\(time) - \(endTime)"
            }
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private var typeBadgeColor: Color {
        switch item.type {
        case .event: .blue
        case .deadline: .red
        case .action: .green
        case .info: .secondary
        }
    }

    private var urgencyBorderColor: Color {
        switch item.urgency {
        case .high: .red.opacity(0.4)
        case .medium: .orange.opacity(0.2)
        case .low: .clear
        }
    }

    private var urgencyBorderWidth: CGFloat {
        item.urgency == .low ? 0 : 1
    }

    private var hasSourceReferences: Bool {
        !(item.sourceHashes ?? []).isEmpty || item.sourceHash != nil
    }
}
