import SwiftUI
import UIKit

struct CardSourceDetailView: View {
    let item: Item

    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var images: [UIImage] = []

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(item.title)
                        .font(.headline)
                    if let description = item.description, !description.isEmpty {
                        Text(description)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }

                if isLoading {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text("Loading source screenshot...")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
                } else if let errorMessage {
                    Text(errorMessage)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
                } else if images.isEmpty {
                    Text("No source screenshot found in your photo library for this card.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
                } else {
                    ForEach(Array(images.enumerated()), id: \.offset) { index, image in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(images.count > 1 ? "Source \(index + 1)" : "Source")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                            Image(uiImage: image)
                                .resizable()
                                .scaledToFit()
                                .clipShape(RoundedRectangle(cornerRadius: 12))
                        }
                    }
                }

                if let rawText = item.rawText, !rawText.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Extracted evidence")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                        Text(rawText)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .padding(12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
                    }
                }
            }
            .padding(16)
        }
        .navigationTitle("Card Source")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await loadImages()
        }
    }

    private func loadSourceHashes() -> [String] {
        let multi = item.sourceHashes ?? []
        if !multi.isEmpty { return multi }
        if let single = item.sourceHash, !single.isEmpty { return [single] }
        return []
    }

    private func loadImages() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            images = try await PhotoService.shared.loadImages(for: loadSourceHashes())
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
