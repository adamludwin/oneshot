import SwiftUI
import Photos

struct DashboardView: View {
    @EnvironmentObject var auth: AuthService
    @StateObject private var viewModel = DashboardViewModel()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    // Scan status
                    if viewModel.isScanning {
                        ScanProgressView(
                            phase: viewModel.scanPhase,
                            progress: viewModel.scanProgress,
                            total: viewModel.scanTotal
                        )
                    }

                    // Photo permission prompt
                    if viewModel.needsPhotoPermission {
                        PermissionCard {
                            await viewModel.requestPhotoAccess()
                        }
                    }

                    // Empty state
                    if !viewModel.isScanning && viewModel.items.isEmpty && !viewModel.needsPhotoPermission {
                        EmptyDashboardView()
                    }

                    // High urgency section
                    let highItems = viewModel.items.filter { $0.urgency == .high }
                    if !highItems.isEmpty {
                        SectionView(title: "NEEDS ATTENTION", items: highItems) { item in
                            viewModel.dismissItem(item)
                        }
                    }

                    // Events & Deadlines
                    let upcoming = viewModel.items.filter {
                        $0.urgency != .high && ($0.type == .event || $0.type == .deadline)
                    }
                    if !upcoming.isEmpty {
                        SectionView(title: "COMING UP", items: upcoming) { item in
                            viewModel.dismissItem(item)
                        }
                    }

                    // Actions / To-Dos
                    let actions = viewModel.items.filter {
                        $0.urgency != .high && $0.type == .action
                    }
                    if !actions.isEmpty {
                        SectionView(title: "TO-DO", items: actions) { item in
                            viewModel.dismissItem(item)
                        }
                    }

                    // Info / FYI
                    let info = viewModel.items.filter {
                        $0.urgency != .high && $0.type == .info
                    }
                    if !info.isEmpty {
                        SectionView(title: "KEY INFO", items: info) { item in
                            viewModel.dismissItem(item)
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 100)
            }
            .navigationTitle("oneshot")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await viewModel.scan() }
                    } label: {
                        Image(systemName: "arrow.trianglehead.2.counterclockwise.rotate.90")
                            .rotationEffect(.degrees(viewModel.isScanning ? 360 : 0))
                            .animation(viewModel.isScanning ? .linear(duration: 1).repeatForever(autoreverses: false) : .default, value: viewModel.isScanning)
                    }
                    .disabled(viewModel.isScanning)
                }
            }
            .refreshable {
                await viewModel.scan()
            }
            .task {
                await viewModel.initialLoad()
            }
            .alert("Error", isPresented: $viewModel.showError) {
                Button("OK") {}
            } message: {
                Text(viewModel.errorMessage)
            }
        }
    }
}

// MARK: - View Model

@MainActor
class DashboardViewModel: ObservableObject {
    @Published var items: [Item] = []
    @Published var isScanning = false
    @Published var scanPhase = "Starting..."
    @Published var scanProgress = 0
    @Published var scanTotal = 0
    @Published var needsPhotoPermission = false
    @Published var showError = false
    @Published var errorMessage = ""

    private var hasLoadedOnce = false

    func initialLoad() async {
        guard !hasLoadedOnce else { return }
        hasLoadedOnce = true

        // Check photo permission
        let status = PhotoService.shared.authorizationStatus
        needsPhotoPermission = (status == .notDetermined || status == .denied || status == .restricted)

        // Load existing items from backend
        do {
            let serverItems: [Item] = try await APIService.shared.get(path: "/api/items")
            self.items = serverItems
        } catch {
            // Silently fail on first load — might not have backend yet
            print("Failed to load items: \(error)")
        }

        // Auto-scan if we have permission
        if !needsPhotoPermission {
            await scan()
        }
    }

    func requestPhotoAccess() async {
        let granted = await PhotoService.shared.requestAccess()
        needsPhotoPermission = !granted
        if granted {
            await scan()
        }
    }

    func scan() async {
        guard !isScanning else { return }
        isScanning = true
        scanPhase = "Loading config..."
        scanProgress = 0

        do {
            // 1. Load API key
            try await AnalysisService.shared.loadConfig()

            // 2. Fetch new screenshots
            scanPhase = "Scanning screenshots..."
            let screenshots = try await PhotoService.shared.fetchNewScreenshots()

            if screenshots.isEmpty {
                scanPhase = "No new screenshots"
                try? await Task.sleep(for: .seconds(1))
                isScanning = false
                return
            }

            scanTotal = screenshots.count
            var newItems: [Item] = []

            // 3. Analyze each screenshot
            for (i, (asset, image)) in screenshots.enumerated() {
                scanProgress = i + 1
                scanPhase = "Analyzing \(scanProgress) of \(scanTotal)..."

                do {
                    let extracted = try await AnalysisService.shared.analyzeScreenshot(image)
                    let hash = PhotoService.shared.hashForAsset(asset)
                    let items = extracted.map { $0.toItem(sourceHash: hash) }
                    newItems.append(contentsOf: items)
                } catch {
                    print("Failed to analyze screenshot \(i): \(error)")
                }
            }

            // 4. Send to backend
            if !newItems.isEmpty {
                scanPhase = "Saving..."
                let itemDicts = newItems.map { item -> [String: Any] in
                    var dict: [String: Any] = [
                        "type": item.type.rawValue,
                        "title": item.title,
                        "urgency": item.urgency.rawValue,
                        "category": item.category.rawValue,
                    ]
                    if let d = item.date { dict["date"] = d }
                    if let t = item.time { dict["time"] = t }
                    if let et = item.endTime { dict["endTime"] = et }
                    if let l = item.location { dict["location"] = l }
                    if let d = item.description { dict["description"] = d }
                    if let h = item.sourceHash { dict["source_hash"] = h }
                    if let r = item.rawText { dict["rawText"] = r }
                    if let p = item.people { dict["people"] = p }
                    return dict
                }

                struct BulkInsertResponse: Codable {
                    let inserted: Int
                    let items: [Item]
                }

                do {
                    let _: BulkInsertResponse = try await APIService.shared.post(
                        path: "/api/items",
                        body: ["items": itemDicts]
                    )
                } catch {
                    print("Failed to save items to backend: \(error)")
                }
            }

            // 5. Advance checkpoint
            PhotoService.shared.advanceSyncCheckpoint()

            // 6. Reload all items
            do {
                let serverItems: [Item] = try await APIService.shared.get(path: "/api/items")
                self.items = serverItems
            } catch {
                // If backend is down, use local items
                self.items.append(contentsOf: newItems)
            }

        } catch {
            errorMessage = error.localizedDescription
            showError = true
        }

        isScanning = false
    }

    func dismissItem(_ item: Item) {
        guard let id = item.id else { return }
        items.removeAll { $0.id == id }
        Task {
            try? await APIService.shared.delete(path: "/api/items/\(id)")
        }
    }
}

// MARK: - Sub-views

struct ScanProgressView: View {
    let phase: String
    let progress: Int
    let total: Int

    var body: some View {
        HStack(spacing: 12) {
            ProgressView()
            VStack(alignment: .leading, spacing: 2) {
                Text(phase)
                    .font(.subheadline.weight(.medium))
                if total > 0 {
                    ProgressView(value: Double(progress), total: Double(total))
                        .tint(.primary)
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14))
    }
}

struct PermissionCard: View {
    let action: () async -> Void

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "photo.on.rectangle.angled")
                .font(.system(size: 36))
                .foregroundStyle(.secondary)
            Text("Enable screenshot access")
                .font(.headline)
            Text("OneShot needs to read your screenshots to extract events and to-dos.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("Grant Access") {
                Task { await action() }
            }
            .buttonStyle(.borderedProminent)
            .tint(.primary)
        }
        .padding(24)
        .frame(maxWidth: .infinity)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
    }
}

struct EmptyDashboardView: View {
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "camera.viewfinder")
                .font(.system(size: 48, weight: .thin))
                .foregroundStyle(.tertiary)
            Text("No items yet")
                .font(.headline)
                .foregroundStyle(.secondary)
            Text("Take screenshots of schedules, texts, emails — then pull to refresh.")
                .font(.subheadline)
                .foregroundStyle(.tertiary)
                .multilineTextAlignment(.center)
        }
        .padding(40)
        .frame(maxWidth: .infinity)
    }
}

struct SectionView: View {
    let title: String
    let items: [Item]
    let onDismiss: (Item) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .tracking(0.5)

            ForEach(items, id: \.stableId) { item in
                CardView(item: item, onDismiss: { onDismiss(item) })
            }
        }
    }
}
