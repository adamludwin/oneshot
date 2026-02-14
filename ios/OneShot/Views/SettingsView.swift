import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var auth: AuthService
    @State private var showSignOutConfirm = false
    @State private var showResetConfirm = false

    var body: some View {
        NavigationStack {
            List {
                // Account
                Section("Account") {
                    if let user = auth.currentUser {
                        if let name = user.name {
                            LabeledContent("Name", value: name)
                        }
                        if let email = user.email {
                            LabeledContent("Email", value: email)
                        }
                    }

                    Button("Sign Out", role: .destructive) {
                        showSignOutConfirm = true
                    }
                }

                // Data
                Section("Data") {
                    Button("Re-scan All Screenshots") {
                        showResetConfirm = true
                    }

                    LabeledContent("Version", value: "0.1.0")
                }

                // About
                Section {
                    Text("OneShot reads your screenshots, extracts events, deadlines, and to-dos using AI, and puts everything on one dashboard.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Settings")
            .confirmationDialog("Sign out?", isPresented: $showSignOutConfirm, titleVisibility: .visible) {
                Button("Sign Out", role: .destructive) {
                    auth.signOut()
                }
            }
            .confirmationDialog("Re-scan all screenshots?", isPresented: $showResetConfirm, titleVisibility: .visible) {
                Button("Re-scan Everything") {
                    PhotoService.shared.resetSync()
                }
            } message: {
                Text("This will re-process all your screenshots on next refresh. Existing items won't be duplicated.")
            }
        }
    }
}
